import { expect } from 'chai'

/* Imports: External */
import { ethers } from 'ethers'

/* Imports: Internal */
import { DockerComposeNetwork } from './shared/docker-compose'
import { OptimismEnv } from './shared/env'
import { l2Provider } from './shared/utils'

describe('Monotonicity Tests', () => {
  const dockerComposeNetwork = new DockerComposeNetwork()

  describe('l2geth monotonicity', () => {
    it('should not increment the timestamp when it loses connection to L1', async () => {
      const latestBlock = await l2Provider.getBlock('latest')
      const initialTimestamp = latestBlock.timestamp

      // Shut down the L1 chain temporarily.
      await dockerComposeNetwork.stop('l1_chain')
    })  
  })
})
