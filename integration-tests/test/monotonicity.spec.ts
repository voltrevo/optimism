import { expect } from 'chai'

/* Imports: External */
import { ethers } from 'ethers'

/* Imports: Internal */
import { DockerComposeNetwork, ServiceNames } from './shared/docker-compose'
import { OptimismEnv } from './shared/env'
import { l2Provider, sleep } from './shared/utils'

const docker = new DockerComposeNetwork()

const resetServiceConnection = async (service: ServiceNames) => {
  await docker.exec(service, 'tc qdisc del dev eth0 root')
}

const setServiceResponseDelayMs = async (
  service: ServiceNames,
  delayMs: number
) => {
  await resetServiceConnection(service)
  await docker.exec(
    service,
    `tc qdisc add dev eth0 root netem delay ${delayMs}ms`
  )
}

const disconnectService = async (service: ServiceNames) => {
  await setServiceResponseDelayMs(service, 1000000000)
}

describe('Monotonicity Tests', () => {
  let env: OptimismEnv
  before(async () => {
    env = await OptimismEnv.new()
  })

  describe.skip('l2geth monotonicity', () => {
    describe('when connection to L1 is unstable', () => {
      afterEach(async () => {
        await resetServiceConnection('l1_chain')
      })

      it('should not increment the timestamp while it does not have connection to L1', async () => {
        const latestBlock = await l2Provider.getBlock('latest')
        const initialTimestamp = latestBlock.timestamp

        // Set a ridiculous delay
        await disconnectService('l1_chain')

        // TODO: How long should we be waiting?
        for (let i = 0; i < 10; i++) {
          await sleep(1000)
          const result = await env.l2Wallet.sendTransaction({
            to: `0x${'11'.repeat(20)}`,
          })
          expect(result.timestamp).to.equal(initialTimestamp)
        }

        // Reset the connection and wait a second so L2 geth syncs.
        await resetServiceConnection('l1_chain')
        await sleep(1000)

        // New timestamp should be greater than the original one.
        const result = await env.l2Wallet.sendTransaction({
          to: `0x${'11'.repeat(20)}`,
        })
        expect(result.timestamp).to.be.greaterThan(initialTimestamp)
      })
    })

    describe('when has just finished restarting', async () => {
      beforeEach(async () => {
        await docker.restart('l2geth')
      })
    })

    describe('when is in the middle of a restart', async () => {
      beforeEach(() => {
        docker.restart('l2geth')
      })
    })
  })
})
