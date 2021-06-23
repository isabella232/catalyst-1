import cors from 'cors'
import { DECENTRALAND_ADDRESS } from 'decentraland-katalyst-commons/addresses'
import { DAOContractClient } from 'decentraland-katalyst-commons/DAOClient'
import { Metrics } from 'decentraland-katalyst-commons/metrics'
import { DAOContract } from 'decentraland-katalyst-contracts/DAOContract'
import express from 'express'
import morgan from 'morgan'
import * as path from 'path'
import { ConfigService } from './config/configService'
import { lighthouseConfigStorage } from './config/simpleStorage'
import { patchLog } from './misc/logging'
import { pickName } from './misc/naming'
import { IRealm } from './peerjs-server'
import { ArchipelagoService } from './peers/archipelagoService'
import { IdService } from './peers/idService'
import { initPeerJsServer } from './peers/initPeerJsServer'
import { defaultPeerMessagesHandler } from './peers/peerMessagesHandler'
import { PeersService } from './peers/peersService'
import { configureRoutes } from './routes'
import { AppServices } from './types'

const LIGHTHOUSE_PROTOCOL_VERSION = '1.0.0'
const DEFAULT_ETH_NETWORK = 'ropsten'

const CURRENT_ETH_NETWORK = process.env.ETH_NETWORK ?? DEFAULT_ETH_NETWORK

;(async function () {
  const daoClient = new DAOContractClient(DAOContract.withNetwork(CURRENT_ETH_NETWORK))

  const name = await pickName(process.env.LIGHTHOUSE_NAMES, daoClient)
  console.info('Picked name: ' + name)

  patchLog(name)

  const accessLogs = parseBoolean(process.env.ACCESS ?? 'false')
  const port = parseInt(process.env.PORT ?? '9000')
  const noAuth = parseBoolean(process.env.NO_AUTH ?? 'false')
  const secure = parseBoolean(process.env.SECURE ?? 'false')
  const enableMetrics = parseBoolean(process.env.METRICS ?? 'true')
  const idAlphabet = process.env.ID_ALPHABET ? process.env.ID_ALPHABET : undefined
  const idLength = process.env.ID_LENGTH ? parseInt(process.env.ID_LENGTH) : undefined
  const restrictedAccessAddress = process.env.RESTRICTED_ACCESS_ADDRESS ?? DECENTRALAND_ADDRESS

  function parseBoolean(string: string) {
    return string.toLowerCase() === 'true'
  }

  const configService = await ConfigService.build({
    storage: lighthouseConfigStorage,
    globalConfig: { ethNetwork: CURRENT_ETH_NETWORK }
  })

  const app = express()

  const idService = new IdService({ alphabet: idAlphabet, idLength })

  const server = app.listen(port, async () => {
    console.info(`==> Lighthouse listening on port ${port}.`)
  })

  const appServices: AppServices = {
    peersService: () => peersService,
    archipelagoService: () => archipelagoService,
    configService,
    idService
  }

  const peerServer = initPeerJsServer({
    netServer: server,
    noAuth,
    ethNetwork: CURRENT_ETH_NETWORK,
    messagesHandler: defaultPeerMessagesHandler(appServices),
    ...appServices
  })

  function getPeerJsRealm(): IRealm {
    return peerServer.get('peerjs-realm')
  }

  if (enableMetrics) {
    Metrics.initialize()
  }

  const peersService = new PeersService(getPeerJsRealm)

  app.use(cors())
  app.use(express.json())
  if (accessLogs) {
    app.use(morgan('combined'))
  }

  const archipelagoService = new ArchipelagoService(appServices)

  configureRoutes(
    app,
    { configService },
    {
      name,
      version: LIGHTHOUSE_PROTOCOL_VERSION,
      ethNetwork: CURRENT_ETH_NETWORK,
      restrictedAccessSigner: restrictedAccessAddress,
      env: {
        secure,
        commitHash: process.env.COMMIT_HASH,
        catalystVersion: process.env.CATALYST_VERSION
      }
    }
  )

  app.use('/peerjs', peerServer)

  const _static = path.join(__dirname, '../static')

  app.use('/monitor', express.static(_static + '/monitor'))
})().catch((e) => {
  console.error('Exiting process because of unhandled exception', e)
  process.exit(1)
})
