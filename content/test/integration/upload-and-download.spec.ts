import { sleep } from '@dcl/snapshots-fetcher/dist/utils'
import { DeploymentData } from 'dcl-catalyst-client'
import { Entity as ControllerEntity, EntityType } from 'dcl-catalyst-commons'
import { makeNoopSynchronizationManager } from '../helpers/service/synchronization/MockedSynchronizationManager'
import { makeNoopValidator } from '../helpers/service/validations/NoOpValidator'
import { assertDeploymentsAreReported, buildDeployment } from './E2EAssertions'
import { loadStandaloneTestEnvironment } from './E2ETestEnvironment'
import { buildDeployData } from './E2ETestUtils'
import { TestProgram } from './TestProgram'

loadStandaloneTestEnvironment()('End 2 end deploy test', (testEnv) => {
  let server: TestProgram
  const POINTER0 = 'X0,Y0'
  const POINTER1 = 'X1,Y1'

  beforeEach(async () => {
    server = await testEnv.configServer().andBuild()
    makeNoopSynchronizationManager(server.components.synchronizationManager)
    makeNoopValidator(server.components)
    await server.startProgram()
  })

  it('When a user tries to deploy the same entity twice, then an exception is thrown', async () => {
    // Build data for deployment
    const { deployData } = await buildDeployData([POINTER0, POINTER1], { metadata: 'this is just some metadata"' })

    // Execute first deploy
    const ret1 = await server.deploy(deployData)

    await sleep(100)

    const ret2 = await server.deploy(deployData)

    // Try to re deploy, and don't fail since it is an idempotent operation
    expect(ret1).toEqual(ret2)
  })

  it(`Deploy and retrieve some content`, async () => {
    //------------------------------
    // Deploy the content
    //------------------------------
    const { deployData, controllerEntity: entityBeingDeployed } = await buildDeployData([POINTER0, POINTER1], {
      metadata: 'this is just some metadata',
      contentPaths: ['test/integration/resources/some-binary-file.png', 'test/integration/resources/some-text-file.txt']
    })

    const creationTimestamp = await server.deploy(deployData)
    const deployment = buildDeployment(deployData, entityBeingDeployed, creationTimestamp)
    const deltaTimestamp = Date.now() - creationTimestamp
    expect(deltaTimestamp).toBeLessThanOrEqual(100)
    expect(deltaTimestamp).toBeGreaterThanOrEqual(0)

    //------------------------------
    // Retrieve the entity by id
    //------------------------------
    const scenesById: ControllerEntity[] = await server.getEntitiesByIds(EntityType.SCENE, deployData.entityId)
    await validateReceivedData(scenesById, deployData)

    //------------------------------
    // Retrieve the entity by pointer
    //------------------------------
    const scenesByPointer: ControllerEntity[] = await server.getEntitiesByPointers(EntityType.SCENE, [POINTER0])
    await validateReceivedData(scenesByPointer, deployData)

    await assertDeploymentsAreReported(server, deployment)
  })

  async function validateReceivedData(receivedScenes: ControllerEntity[], deployData: DeploymentData) {
    expect(receivedScenes.length).toBe(1)
    const scene: ControllerEntity = receivedScenes[0]
    expect(scene.id).toBe(deployData.entityId)
    expect(scene.metadata).toBe('this is just some metadata')

    expect(scene.pointers.length).toBe(2)
    expect(equalsCaseInsensitive(scene.pointers[0], POINTER0)).toBeTruthy()
    expect(equalsCaseInsensitive(scene.pointers[1], POINTER1)).toBeTruthy()

    expect(scene.content).toBeDefined()
    expect(scene.content!.length).toBe(2)

    for (const contentElement of scene.content!) {
      const downloadedContent = await server.downloadContent(contentElement.hash)
      expect(downloadedContent).toEqual(deployData.files.get(contentElement.hash)!)
    }
  }
})

function equalsCaseInsensitive(text1: string, text2: string): boolean {
  return text1.toLowerCase() === text2.toLowerCase()
}
