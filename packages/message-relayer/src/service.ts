/* Imports: External */
import { Contract, ethers, Wallet, BigNumber, providers } from 'ethers'
import * as rlp from 'rlp'
import { MerkleTree } from 'merkletreejs'

/* Imports: Internal */
import { fromHexString, sleep } from '@eth-optimism/core-utils'
import { BaseService } from '@eth-optimism/common-ts'
import SpreadSheet from './spreadsheet'

import { loadContract, loadContractFromManager } from '@eth-optimism/contracts'
import { StateRootBatchHeader, SentMessage, SentMessageProof } from './types'

interface MessageRelayerOptions {
  // Providers for interacting with L1 and L2.
  l1RpcProvider: providers.JsonRpcProvider
  l2RpcProvider: providers.JsonRpcProvider

  // Address of the AddressManager contract, used to resolve the various addresses we'll need
  // within this service.
  addressManagerAddress: string

  // Wallet instance, used to sign and send the L1 relay transactions.
  l1Wallet: Wallet

  // Max gas to relay messages with.
  relayGasLimit: number

  // Height of the L2 transaction to start searching for L2->L1 messages.
  fromL2TransactionIndex?: number

  // Interval in seconds to wait between loops.
  pollingInterval?: number

  // Number of blocks that L2 is "ahead" of transaction indices. Can happen if blocks are created
  // on L2 after the genesis but before the first state commitment is published.
  l2BlockOffset?: number

  // L1 block to start querying events from. Recommended to set to the StateCommitmentChain deploy height
  l1StartOffset?: number

  // Number of blocks within each getLogs query - max is 2000
  getLogsInterval?: number

  // Append txs to a spreadsheet instead of submitting transactions
  spreadsheetMode?: boolean
  spreadsheet?: SpreadSheet
}

const optionSettings = {
  relayGasLimit: { default: 4_000_000 },
  fromL2TransactionIndex: { default: 0 },
  pollingInterval: { default: 5000 },
  l2BlockOffset: { default: 1 },
  l1StartOffset: { default: 0 },
  getLogsInterval: { default: 2000 },
  spreadsheetMode: { default: false },
}

export class MessageRelayerService extends BaseService<MessageRelayerOptions> {
  constructor(options: MessageRelayerOptions) {
    super('Message_Relayer', options, optionSettings)
  }

  protected spreadsheetMode: boolean
  protected spreadsheet: SpreadSheet

  private state: {
    lastFinalizedTxHeight: number
    nextUnfinalizedTxHeight: number
    lastQueriedL1Block: number
    eventCache: ethers.Event[]
    Lib_AddressManager: Contract
    OVM_StateCommitmentChain: Contract
    OVM_L1CrossDomainMessenger: Contract
    OVM_L2CrossDomainMessenger: Contract
    OVM_L2ToL1MessagePasser: Contract
  }

  protected async _init(): Promise<void> {
    this.logger.info('Initializing message relayer', {
      relayGasLimit: this.options.relayGasLimit,
      fromL2TransactionIndex: this.options.fromL2TransactionIndex,
      pollingInterval: this.options.pollingInterval,
      l2BlockOffset: this.options.l2BlockOffset,
      getLogsInterval: this.options.getLogsInterval,
      spreadSheetMode: this.options.spreadsheetMode,
    })

    // Need to improve this, sorry.
    this.state = {} as any

    const address = await this.options.l1Wallet.getAddress()
    this.logger.info('Using L1 EOA', { address })

    this.state.Lib_AddressManager = loadContract(
      'Lib_AddressManager',
      this.options.addressManagerAddress,
      this.options.l1RpcProvider
    )

    this.logger.info('Connecting to OVM_StateCommitmentChain...')
    this.state.OVM_StateCommitmentChain = await loadContractFromManager({
      name: 'OVM_StateCommitmentChain',
      Lib_AddressManager: this.state.Lib_AddressManager,
      provider: this.options.l1RpcProvider,
    })
    this.logger.info('Connected to OVM_StateCommitmentChain', {
      address: this.state.OVM_StateCommitmentChain.address,
    })

    this.logger.info('Connecting to OVM_L1CrossDomainMessenger...')
    this.state.OVM_L1CrossDomainMessenger = await loadContractFromManager({
      name: 'OVM_L1CrossDomainMessenger',
      proxy: 'Proxy__OVM_L1CrossDomainMessenger',
      Lib_AddressManager: this.state.Lib_AddressManager,
      provider: this.options.l1RpcProvider,
    })
    this.logger.info('Connected to OVM_L1CrossDomainMessenger', {
      address: this.state.OVM_L1CrossDomainMessenger.address,
    })

    this.logger.info('Connecting to OVM_L2CrossDomainMessenger...')
    this.state.OVM_L2CrossDomainMessenger = await loadContractFromManager({
      name: 'OVM_L2CrossDomainMessenger',
      Lib_AddressManager: this.state.Lib_AddressManager,
      provider: this.options.l2RpcProvider,
    })
    this.logger.info('Connected to OVM_L2CrossDomainMessenger', {
      address: this.state.OVM_L2CrossDomainMessenger.address,
    })

    this.logger.info('Connecting to OVM_L2ToL1MessagePasser...')
    this.state.OVM_L2ToL1MessagePasser = loadContract(
      'OVM_L2ToL1MessagePasser',
      '0x4200000000000000000000000000000000000000',
      this.options.l2RpcProvider
    )
    this.logger.info('Connected to OVM_L2ToL1MessagePasser', {
      address: this.state.OVM_L2ToL1MessagePasser.address,
    })

    this.logger.info('Connected to all contracts.')

    if (this.options.spreadsheetMode) {
      this.logger.info('Running in spreadsheet mode')
    }

    this.state.lastQueriedL1Block = this.options.l1StartOffset
    this.state.eventCache = []

    this.state.lastFinalizedTxHeight = this.options.fromL2TransactionIndex || 0
    this.state.nextUnfinalizedTxHeight =
      this.options.fromL2TransactionIndex || 0
  }

  protected async _start(): Promise<void> {
    while (this.running) {
      await sleep(this.options.pollingInterval)

      try {
        // L2MessageRelayer is the name given to the account that's allowed to relay messages
        // from L2 to L1. We'll need to verify that the user's wallet is actually allowed to
        // relay messages or we'll just get an error. We perform this check on every iteration of
        // the loop
        const relayer = await this.state.Lib_AddressManager.getAddress(
          'OVM_L2MessageRelayer'
        )

        // If the L2MessageRelayer is set to address(0), then *any* account can relay messages and
        // we can simply skip this step.
        if (relayer !== ethers.constants.AddressZero) {
          const address = await this.options.l1Wallet.getAddress()
          if (relayer !== address) {
            throw new Error(
              `OVM_L2MessageRelayer (${relayer}) is not set to message-passer EOA ${address}`
            )
          }
        }

        // Now we check to see if the last transaction that was previously unfinalized is now
        // finalized. If not, we simply stop and wait for the next loop iteration.
        this.logger.info('Checking for newly finalized transactions...')
        if (
          !(await this._isTransactionFinalized(
            this.state.nextUnfinalizedTxHeight
          ))
        ) {
          this.logger.info('Did not find any newly finalized transactions', {
            retryAgainInS: Math.floor(this.options.pollingInterval / 1000),
          })

          continue
        }

        // The previously unfinalized transaction is now finalized, so we mark it as such.
        this.state.lastFinalizedTxHeight = this.state.nextUnfinalizedTxHeight

        // Next, we proceed to iterate through batches to find the next unfinalized transaction.
        while (
          await this._isTransactionFinalized(this.state.nextUnfinalizedTxHeight)
        ) {
          // If transaction N is finalized, then all transactions in the same batch must also be
          // finalized. So we'll reflect this fact by bumping the next unfinalized transaction
          // height by the number of elements inside of transaction N's batch.
          const size = (
            await this._getStateBatchHeader(this.state.nextUnfinalizedTxHeight)
          ).batch.batchSize.toNumber()
          this.state.nextUnfinalizedTxHeight += size

          this.logger.info(
            'Found a batch of finalized transaction(s), checking for more...',
            { batchSize: size }
          )

          // To avoid running out of memory, we'll stop searching for newly finalized transactions
          // as soon as we find more than 1000 new transactions. This makes the service a bit slow
          // to get started if you're syncing from 0, but doesn't have any real impact once synced
          // to the tip.
          if (
            this.state.nextUnfinalizedTxHeight -
              this.state.lastFinalizedTxHeight >
            1000
          ) {
            break
          }
        }

        this.logger.info('Found finalized transactions', {
          totalNumber:
            this.state.nextUnfinalizedTxHeight -
            this.state.lastFinalizedTxHeight,
        })

        // This line is the primary reason why we want to limit the number of newly finalized
        // transactions to something like 1000. Otherwise we'll end up trying to find and relay
        // every single message in the chain if syncing this service from 0.
        const messages = await this._getSentMessages(
          this.state.lastFinalizedTxHeight,
          this.state.nextUnfinalizedTxHeight
        )

        if (messages.length === 0) {
          this.logger.info('Did not find any L2->L1 messages', {
            retryAgainInS: Math.floor(this.options.pollingInterval / 1000),
          })
        }

        for (const message of messages) {
          this.logger.info('Found a message sent during transaction', {
            index: message.parentTransactionIndex,
          })

          // We don't need to relay messages if they've already been relayed.
          if (await this._wasMessageRelayed(message)) {
            this.logger.info('Message has already been relayed, skipping.')
            continue
          }

          this.logger.info(
            'Message not yet relayed. Attempting to generate a proof...'
          )

          // We need to generate a proof that the message was actually included as part of the L2
          // chain. Can't execute the relay step without this proof.
          const proof = await this._getMessageProof(message)

          this.logger.info(
            'Successfully generated a proof. Attempting to relay to Layer 1...'
          )

          // And finally: send the message off to L1!
          await this._relayMessageToL1(message, proof)
        }

        this.logger.info(
          'Finished searching through newly finalized transactions',
          {
            retryAgainInS: Math.floor(this.options.pollingInterval / 1000),
          }
        )
      } catch (err) {
        this.logger.error('Caught an unhandled error', {
          message: err.toString(),
          stack: err.stack,
          code: err.code,
        })
      }
    }
  }

  private async _getStateBatchHeader(
    height: number
  ): Promise<
    | {
        batch: StateRootBatchHeader
        stateRoots: string[]
      }
    | undefined
  > {
    const filter = this.state.OVM_StateCommitmentChain.filters.StateBatchAppended()

    let startingBlock = this.state.lastQueriedL1Block
    while (
      startingBlock < (await this.options.l1RpcProvider.getBlockNumber())
    ) {
      this.state.lastQueriedL1Block = startingBlock
      this.logger.info('Querying events', {
        startingBlock,
        endBlock: startingBlock + this.options.getLogsInterval,
      })

      const events: ethers.Event[] = await this.state.OVM_StateCommitmentChain.queryFilter(
        filter,
        startingBlock,
        startingBlock + this.options.getLogsInterval
      )

      this.state.eventCache = this.state.eventCache.concat(events)
      startingBlock += this.options.getLogsInterval
    }

    // tslint:disable-next-line
    const event = this.state.eventCache.find((event) => {
      return (
        event.args._prevTotalElements.toNumber() <= height &&
        event.args._prevTotalElements.toNumber() +
          event.args._batchSize.toNumber() >
          height
      )
    })

    if (event) {
      const transaction = await this.options.l1RpcProvider.getTransaction(
        event.transactionHash
      )
      const [
        stateRoots,
      ] = this.state.OVM_StateCommitmentChain.interface.decodeFunctionData(
        'appendStateBatch',
        transaction.data
      )

      return {
        batch: {
          batchIndex: event.args._batchIndex,
          batchRoot: event.args._batchRoot,
          batchSize: event.args._batchSize,
          prevTotalElements: event.args._prevTotalElements,
          extraData: event.args._extraData,
        },
        stateRoots,
      }
    }

    return
  }

  /**
   * Checks whether the transaction at a given height is finalized.
   * @param height Height of the transaction to check.
   * @returns Whether or not the transaction is finalized.
   */
  private async _isTransactionFinalized(height: number): Promise<boolean> {
    this.logger.info('Checking if tx is finalized', { height })

    // Need to find the batch that corresponds to this transaction.
    const header = await this._getStateBatchHeader(height)

    // If undefined then the batch doesn't exist yet, transaction can't be finalized.
    if (header === undefined) {
      this.logger.info('No state batch header found.')
      return false
    } else {
      this.logger.info('Got state batch header', { header })
    }

    // Check whether the batch is still inside the fraud proof window.
    const insideFraudProofWindow = await this.state.OVM_StateCommitmentChain.insideFraudProofWindow(
      header.batch
    )

    // If the batch is *not* still inside the fraud proof window then it's considered finalized.
    return insideFraudProofWindow === false
  }

  /**
   * Gets all L1 => L2 messages triggered between some start transaction height (inclusive) and an
   * end transaction height (exclusive).
   * @param startHeight Height to start querying from (inclusive).
   * @param endHeight Height to stop querying at (exclusive).
   * @returns All messages sent between the given transaction heights.
   */
  private async _getSentMessages(
    startHeight: number,
    endHeight: number
  ): Promise<SentMessage[]> {
    // We subtract one from endHeight when filtering for events because `queryFilter` is inclusive
    // on both sides. We perform this addition here to avoid having endHeight < startHeight.
    if (startHeight === endHeight) {
      endHeight = startHeight + 1
    }

    // Find all SentMessage events between the two block heights. `queryFilter` is inclusive on
    // both ends, so we'll want to subtract one from endHeight.
    const events = await this.state.OVM_L2CrossDomainMessenger.queryFilter(
      this.state.OVM_L2CrossDomainMessenger.filters.SentMessage(),
      startHeight + this.options.l2BlockOffset,
      endHeight + this.options.l2BlockOffset - 1
    )

    // Now we just need to parse the raw ethers.Event objects into usable structs.
    return events.map((event) => {
      // The emitted message is an encoded call to `OVM_L1CrossDomainMessenger.relayMessage`. Since
      // the `OVM_L1CrossDomainMessenger` and `OVM_L2CrossDomainMessenger` use the same interface
      // for `relayMessage`, we can also decode it using the `OVM_L2CrossDomainMessage` interface.
      const message = event.args.message
      const decoded = this.state.OVM_L2CrossDomainMessenger.interface.decodeFunctionData(
        'relayMessage',
        message
      )

      return {
        target: decoded._target,
        sender: decoded._sender,
        message: decoded._message,
        messageNonce: decoded._messageNonce,
        encodedMessage: message,
        encodedMessageHash: ethers.utils.keccak256(message),
        parentTransactionIndex: event.blockNumber - this.options.l2BlockOffset,
        parentTransactionHash: event.transactionHash,
      }
    })
  }

  /**
   * Checks whether a given message has already been relayed successfully.
   * @param message Message to check.
   * @returns Whether or not the message has been relayed.
   */
  private async _wasMessageRelayed(message: SentMessage): Promise<boolean> {
    return this.state.OVM_L1CrossDomainMessenger.successfulMessages(
      message.encodedMessageHash
    )
  }

  /**
   * Generates the proof of validity for a given message.
   * @param message Message to generate a proof for.
   * @returns Proof of validity for the message.
   */
  private async _getMessageProof(
    message: SentMessage
  ): Promise<SentMessageProof> {
    const messageSlot = ethers.utils.keccak256(
      ethers.utils.keccak256(
        message.encodedMessage +
          this.state.OVM_L2CrossDomainMessenger.address.slice(2)
      ) + '00'.repeat(32)
    )

    // TODO: Complain if the proof doesn't exist.
    const proof = await this.options.l2RpcProvider.send('eth_getProof', [
      this.state.OVM_L2ToL1MessagePasser.address,
      [messageSlot],
      '0x' +
        BigNumber.from(
          message.parentTransactionIndex + this.options.l2BlockOffset
        )
          .toHexString()
          .slice(2)
          .replace(/^0+/, ''),
    ])

    // TODO: Complain if the batch doesn't exist.
    const header = await this._getStateBatchHeader(
      message.parentTransactionIndex
    )

    const elements = []
    for (
      let i = 0;
      i < Math.pow(2, Math.ceil(Math.log2(header.stateRoots.length)));
      i++
    ) {
      if (i < header.stateRoots.length) {
        elements.push(header.stateRoots[i])
      } else {
        elements.push(ethers.utils.keccak256('0x' + '00'.repeat(32)))
      }
    }

    const leaves = elements.map((element) => {
      return fromHexString(element)
    })

    const tree = new MerkleTree(
      leaves,
      (el: Buffer | string): Buffer => {
        // merkletreejs prefers things to be Buffers
        return fromHexString(ethers.utils.keccak256(el))
      }
    )

    const index =
      message.parentTransactionIndex - header.batch.prevTotalElements.toNumber()
    const treeProof = tree.getProof(leaves[index], index).map((element) => {
      return element.data
    })

    return {
      stateRoot: header.stateRoots[index],
      stateRootBatchHeader: header.batch,
      stateRootProof: {
        index,
        siblings: treeProof,
      },
      stateTrieWitness: rlp.encode(proof.accountProof),
      storageTrieWitness: rlp.encode(proof.storageProof[0].proof),
    }
  }

  /**
   * Sends a message to be executed on L1.
   * @param message Message to execute on L1.
   * @param proof Proof of validity for the given message.
   */
  private async _relayMessageToL1(
    message: SentMessage,
    proof: SentMessageProof
  ): Promise<void> {
    if (this.options.spreadsheetMode) {
      // Spreadsheet mode is a special operation mode that allows us to easily review messages
      // in an accessible spreadsheet. We could do the same thing with a database and a frontend
      // but that's significantly more effort for the same effect.
      try {
        await this.options.spreadsheet.addRow({
          target: message.target,
          sender: message.sender,
          message: message.message,
          messageNonce: message.messageNonce.toString(),
          encodedMessage: message.encodedMessage,
          encodedMessageHash: message.encodedMessageHash,
          parentTransactionIndex: message.parentTransactionIndex,
          parentTransactionHash: message.parentTransactionIndex,
          stateRoot: proof.stateRoot,
          batchIndex: proof.stateRootBatchHeader.batchIndex.toString(),
          batchRoot: proof.stateRootBatchHeader.batchRoot,
          batchSize: proof.stateRootBatchHeader.batchSize.toString(),
          prevTotalElements: proof.stateRootBatchHeader.prevTotalElements.toString(),
          extraData: proof.stateRootBatchHeader.extraData,
          index: proof.stateRootProof.index,
          siblings: proof.stateRootProof.siblings.join(','),
          stateTrieWitness: proof.stateTrieWitness.toString('hex'),
          storageTrieWitness: proof.storageTrieWitness.toString('hex'),
        })
        this.logger.info('Submitted relay message to spreadsheet')
      } catch (e) {
        this.logger.error('Cannot submit message to spreadsheet')
        this.logger.error(e.message)
      }
    } else {
      try {
        this.logger.info(
          'Dry-run, checking to make sure proof would succeed...'
        )

        // We want to perform a dry run of the message relaying process just to make sure that
        // there won't be any issues when we actually try to send the message. This will throw an
        // error if the relay process reverts.
        await this.state.OVM_L1CrossDomainMessenger.connect(
          this.options.l1Wallet
        ).callStatic.relayMessage(
          message.target,
          message.sender,
          message.message,
          message.messageNonce,
          proof,
          {
            gasLimit: this.options.relayGasLimit,
          }
        )

        this.logger.info(
          'Proof should succeed. Submitting for real this time...'
        )
      } catch (err) {
        this.logger.error('Proof would fail, skipping', {
          message: err.toString(),
          stack: err.stack,
          code: err.code,
        })
        return
      }

      // If we got this far then the dry run must've succeeded. We'll try to relay the message for
      // real now. This could still fail in some circumstances (e.g., someone else relays the
      // message in between the time when we did the dry run and when we get to this step).
      const result = await this.state.OVM_L1CrossDomainMessenger.connect(
        this.options.l1Wallet
      ).relayMessage(
        message.target,
        message.sender,
        message.message,
        message.messageNonce,
        proof,
        {
          gasLimit: this.options.relayGasLimit,
        }
      )

      this.logger.info('Relay message transaction sent', {
        transactionHash: result,
      })

      try {
        // Wait for the transaction to be included in a block. This will throw an error if the
        // transaction reverted and we'll catch it below.
        const receipt = await result.wait()

        this.logger.info('Relay message included in block', {
          transactionHash: receipt.transactionHash,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed.toString(),
          confirmations: receipt.confirmations,
          status: receipt.status,
        })
      } catch (err) {
        this.logger.error('Real relay attempt failed, skipping.', {
          message: err.toString(),
          stack: err.stack,
          code: err.code,
        })
        return
      }

      this.logger.info('Message successfully relayed to Layer 1!')
    }
  }
}
