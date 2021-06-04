/* Imports: External */
import { ethers, providers } from 'ethers'
import { getContractInterface } from '@eth-optimism/contracts'
import { sleep, NUM_L2_GENESIS_BLOCKS } from '@eth-optimism/core-utils'
import { Service, types } from '@eth-optimism/common-ts'

/* Imports: Internal */
import {
  getCrossDomainMessageHash,
  getMessagesAndProofsForL2Transaction,
  getStateRootBatchByBatchIndex,
} from './relay-tx'

interface Options {
  // Providers for interacting with L1 and L2.
  l1RpcProvider: providers.JsonRpcProvider | string
  l2RpcProvider: providers.JsonRpcProvider | string

  // Address of the OVM_StateCommitmentChain.
  stateCommitmentChain: string | ethers.Contract

  // Address of the L1CrossDomainMessenger.
  l1CrossDomainMessenger: string | ethers.Contract

  // Address of the L2CrossDomainMessenger.
  l2CrossDomainMessenger: string | ethers.Contract

  // Private key for the account that will relay transactions.
  relayerWallet: string | ethers.Wallet

  // Interval in milliseconds to wait between loops when waiting for new transactions to scan.
  pollingIntervalMs: number
}

interface ParsedOptions {
  l1RpcProvider: providers.JsonRpcProvider
  l2RpcProvider: providers.JsonRpcProvider
  stateCommitmentChain: ethers.Contract
  l1CrossDomainMessenger: ethers.Contract
  l2CrossDomainMessenger: ethers.Contract
  relayerWallet: ethers.Wallet
  pollingIntervalMs: number
}

interface State {
  // Index of the next state root batch to sync.
  nextUnsyncedStateRootBatchIndex: number
}

export class MessageRelayerService extends Service<
  Options,
  ParsedOptions,
  State
> {
  constructor(options: Partial<MessageRelayerOptions> = {}) {
    super({
      name: 'message-relayer',
      options: options,
      optionSettings: {
        l1RpcProvider: {
          type: types.JsonRpcProvider,
        },
        l2RpcProvider: {
          type: types.JsonRpcProvider,
        },
        stateCommitmentChain: {
          type: types.Contract(
            getContractInterface('OVM_StateCommitmentChain')
          ),
        },
        l1CrossDomainMessenger: {
          type: types.Contract(
            getContractInterface('OVM_L1CrossDomainMessenger')
          ),
        },
        l2CrossDomainMessenger: {
          type: types.Contract(
            getContractInterface('OVM_L2CrossDomainMessenger')
          ),
        },
        relayerWallet: {
          type: types.Wallet,
        },
        pollingIntervalMs: {
          default: 5000,
          type: types.number,
        },
      },
      state: {
        nextUnsyncedStateRootBatchIndex: 0,
      },
    })
  }

  protected async init(): Promise<void> {
    // Connect contracts to their respective RPC providers.
    this.options.stateCommitmentChain = this.options.stateCommitmentChain.connect(
      this.options.l1RpcProvider
    )
    this.options.l1CrossDomainMessenger = this.options.l1CrossDomainMessenger.connect(
      this.options.l1RpcProvider
    )
    this.options.l2CrossDomainMessenger = this.options.l2CrossDomainMessenger.connect(
      this.options.l2RpcProvider
    )

    // Connect the relayer wallet to the L1 RPC provider.
    this.options.relayerWallet = this.options.relayerWallet.connect(
      this.options.l1RpcProvider
    )
  }

  protected async main(): Promise<void> {
    const nextUnsyncedStateRootBatch = await getStateRootBatchByBatchIndex(
      this.options.l1RpcProvider,
      this.options.stateCommitmentChain.address,
      this.state.nextUnsyncedStateRootBatchIndex
    )

    if (nextUnsyncedStateRootBatch === null) {
      await sleep(this.options.pollingIntervalMs)
      return
    }

    const isBatchUnfinalized = await this.options.stateCommitmentChain.insideFraudProofWindow(
      nextUnsyncedStateRootBatch.header
    )

    if (isBatchUnfinalized) {
      await sleep(this.options.pollingIntervalMs)
      return
    }

    const batchPrevTotalElements = nextUnsyncedStateRootBatch.header.prevTotalElements.toNumber()
    const batchSize = nextUnsyncedStateRootBatch.header.batchSize.toNumber()
    const messageEvents = await this.options.l2CrossDomainMessenger.queryFilter(
      this.options.l2CrossDomainMessenger.filters.SentMessage(),
      batchPrevTotalElements + NUM_L2_GENESIS_BLOCKS,
      batchPrevTotalElements + batchSize + NUM_L2_GENESIS_BLOCKS
    )

    this.logger.info('found next finalized transaction batch', {
      batchIndex: this.state.nextUnsyncedStateRootBatchIndex,
      batchPrevTotalElements,
      batchSize,
      numSentMessages: messageEvents.length,
    })

    for (const messageEvent of messageEvents) {
      this.logger.info('generating proof data for message', {
        transactionHash: messageEvent.transactionHash,
        eventIndex: messageEvent.logIndex,
      })

      const messagePairs = await getMessagesAndProofsForL2Transaction(
        this.options.l1RpcProvider,
        this.options.l2RpcProvider,
        this.options.stateCommitmentChain.address,
        this.options.l2CrossDomainMessenger.address,
        messageEvent.transactionHash
      )

      for (const { message, proof } of messagePairs) {
        const messageHash = getCrossDomainMessageHash(message)

        this.logger.info('relaying message', {
          transactionHash: messageEvent.transactionHash,
          messageHash,
          message,
        })

        try {
          const result = await this.options.l1CrossDomainMessenger
            .connect(this.options.relayerWallet)
            .relayMessage(
              message.target,
              message.sender,
              message.message,
              message.messageNonce,
              proof
            )

          const receipt = await result.wait()

          this.logger.info('relayed message successfully', {
            messageHash,
            relayTransactionHash: receipt.transactionHash,
          })
        } catch (err) {
          const wasAlreadyRelayed = await this.options.l1CrossDomainMessenger.successfulMessages(
            messageHash
          )

          if (wasAlreadyRelayed) {
            this.logger.info('message was already relayed', {
              messageHash,
            })
          } else {
            this.logger.error('caught an error while relaying a message', {
              message: err.message,
              stack: err.stack,
              code: err.code,
            })
          }
        }
      }
    }

    this.state.nextUnsyncedStateRootBatchIndex += 1
  }
}
