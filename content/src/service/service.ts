import { ContentStorage } from "../storage/ContentStorage";
import { FileHash, Hashing } from "./Hashing";
import { EntityType, Pointer, EntityId, Entity } from "./Entity";
import { Validation } from "./Validation";

export class Service {
    
    private referencedEntities: Map<EntityType, Map<Pointer, EntityId>> = new Map();
    private entities: Map<EntityId, Entity> = new Map();
    private storage: ContentStorage;

    getEntitiesByPointers(type: EntityType, ids: Pointer[]): Promise<Entity[]> {
        return Promise.resolve([])
    }

    getEntitiesByIds(type: EntityType, ids: EntityId[]): Promise<Entity[]> {
        return Promise.resolve([])
    }

    getActivePointers(type: EntityType): Promise<Pointer[]> {
        return Promise.resolve([])
    }

    async deployEntity(files: Set<File>, entityId: EntityId, ethAddress: EthAddress, signature: Signature): Promise<Timestamp> {
        // Validate signature
        Validation.validateSignature(entityId, ethAddress, signature)

        // Validate request size
        Validation.validateRequestSize(files)

        // Find entity file and make sure its hash is the expected
        const entityFile: File = this.findEntityFile(files)
        if (entityId !== await Hashing.calculateHash(entityFile)) {
            throw new Error("Entity file's hash didn't match the signed entity id.")    
        }

        // Remove entity file from files set and parse it into an Entity
        files.delete(entityFile)
        const entity: Entity = this.parseEntityFile(entityFile)

        // Validate ethAddress access
        Validation.validateAccess(entity.pointers, ethAddress, entity.type)

        // Validate that the entity is "fresh"
        Validation.validateFreshDeployment(entity)

        // Type validation
        Validation.validateType(entity)

        // Hash all files, and validate them
        const hashes: Map<FileHash, File> = await Hashing.calculateHashes(files)
        const alreadyStoredHashes: Map<FileHash, Boolean> = await this.isContentAvailable(Array.from(hashes.keys()));
        Validation.validateHashes(entity, hashes, alreadyStoredHashes)

        // IF THIS POINT WAS REACHED, THEN THE DEPLOYMENT WILL BE COMMITED

        // Make sure thay type is registered. If not, register it
        if (!this.referencedEntities.has(entity.type)) {
            this.referencedEntities.set(entity.type, new Map())
        }

        // Delete entities and pointers that the new deployment would overwrite
        await this.deleteOverwrittenEntities(entity)

        // Register the new entity on global variables
        await this.commitNewEntity(hashes, alreadyStoredHashes, entityId, entity)    
    
        // TODO: Save audit information

        // TODO: Add to history

        return Promise.resolve(0)
    }

    private async commitNewEntity(hashes: Map<FileHash, File>, alreadyStoredHashes: Map<FileHash, Boolean>, entityId: EntityId, entity: Entity): Promise<void> {
        // Register entity
        this.entities.set(entityId, entity)    

        // Make each pointer point to new entity
        let entitiesInType: Map<Pointer, EntityId> | undefined = this.referencedEntities.get(entity.type)
        entity.pointers.forEach(pointer => entitiesInType?.set(pointer, entityId))

        // Store content that isn't already stored
        const contentStorageActions: Promise<void>[] = Array.from(hashes.entries())
            .filter(([fileHash, file]) => !alreadyStoredHashes.get(fileHash))
            .map(([fileHash, file]) => this.storage.store(this.resolveCategory(StorageCategory.CONTENTS), fileHash, file.content))
        
        
        // Store reference from pointers to entity
        const pointerStorageActions: Promise<void>[]= Array.from(entity.pointers)
            .map((pointer: Pointer) => this.storage.store(this.resolveCategory(StorageCategory.POINTERS, entity.type), pointer, Buffer.from(entityId)));
        
        await Promise.all([...contentStorageActions, ...pointerStorageActions])
    }

    private async deleteOverwrittenEntities(entity: Entity): Promise<void> {
        let orphanPointers: Set<Pointer> = new Set()
        let allEntities: Set<EntityId> = new Set()

        // Calculate the entities and pointers that the new deployment would overwrite 
        Array.from(entity.pointers.values())
            .map((pointer: Pointer) => this.referencedEntities.get(entity.type)?.get(pointer))
            .filter((entityId: EntityId | undefined) => !!entityId)
            .forEach((entityId: EntityId) => {
                allEntities.add(entityId)

                const entitysPointers: Set<Pointer> = this.entities.get(entityId)?.pointers || new Set()
                Array.from(entitysPointers)
                    .filter((pointer: Pointer) => !entity.pointers.has(pointer))        
                    .forEach((pointer: Pointer) => orphanPointers.add(pointer))
            })

        // Delete orphan pointers
        const pointerDeletionActions: Promise<void>[] = Array.from(orphanPointers)
            .map((orphanPointer: Pointer) => this.storage.delete(this.resolveCategory(StorageCategory.POINTERS, entity.type), orphanPointer))
        
        for (const orphanPointer of orphanPointers) {
            this.referencedEntities.get(entity.type)?.delete(orphanPointer)
        }

        await Promise.all(pointerDeletionActions)
           
        // Delete the entities that will be overwriten from the global map
        for (const entityId of allEntities.keys()) {
            this.entities.delete(entityId)            
        }
    }

    private findEntityFile(files: Set<File>): File {
        const filesWithName = Array.from(files.values())
            .filter(file => file.name === 'entity.json')
        if (filesWithName.length === 0) {
            throw new Error("Failed to find the entity file. Please make sure that it is named 'entity.json'.")
        } else if (filesWithName.length > 1) {
            throw new Error("Found more than one file called 'entity.json'. Please make sure you upload only one with that name.")
        }

        return filesWithName[0];
    }

    private parseEntityFile(file: File | undefined): Entity {
        if (!file) {
            throw new Error("Couldn't find a file that matched the entityId")
        }

        let entity: Entity;
        try {        
            entity = JSON.parse(file.content.toString())
        } catch (ex) {
            throw new Error("Failed to parse the entity file. Please make sure thay it is a valid json.\n" + ex)
        }

        return entity
    }

    getAuditInfo(type: EntityType, id: EntityId): Promise<AuditInfo> {
        return Promise.resolve({
            deployedTimestamp: 1,
            ethAddress: "",
            signature: ""
        })
    }

    getHistory(from?: Timestamp, to?: Timestamp, type?: HistoryType): Promise<HistoryEvent[]> {
        return Promise.resolve([])
    }

    isContentAvailable(fileHashes: FileHash[]): Promise<Map<FileHash, Boolean>> {
        // TODO. This is always returning false, we have to make it work...
        return Promise.resolve(new Map(fileHashes.map(hash => [hash, false])))
    }

    // getContent() // TODO
    // getContenetURL() //ToAvoid

    /** Resolve a category name, based on the storage category and the entity's type */
    private resolveCategory(storageCategory: StorageCategory, type?: EntityType): string {
        return storageCategory + (storageCategory === StorageCategory.POINTERS && type ? type : "")
    }
}

type HistoryEvent = {
    timestamp: Timestamp
}

export type DeploymentEvent = HistoryEvent & {
    entityType: EntityType
    entityId: EntityId
}

export type SnapshotEvent = HistoryEvent & {
    activeEntities: Map<EntityType, Map<Pointer, EntityId>>
    deltaEventsHash: FileHash
    previousSnapshotTimestamp: Timestamp
}

export type AuditInfo = {
    deployedTimestamp: Timestamp    
    ethAddress: EthAddress
    signature: Signature    
}

export type File = {
    name: string
    content: Buffer
}

export type Timestamp = number
export type Signature = string
export type EthAddress = string

export const enum HistoryType {
    DEPLOYMENT,
    SNAPSHOT,
}

const enum StorageCategory {
    HISTORY = "history",
    CONTENTS = "contents",
    PROOFS = "proofs",
    POINTERS = "pointers",
}