// SPDX-License-Identifier: MIT
pragma solidity >0.5.0 <0.8.0;
pragma experimental ABIEncoderV2;

/* Library Imports */
import { Lib_OVMCodec } from "../../libraries/codec/Lib_OVMCodec.sol";

/* Interface Imports */
import { iOVM_ChainStorageContainer } from "./iOVM_ChainStorageContainer.sol";

/**
 * @title iOVM_CanonicalTransactionChain
 */
interface iOVM_CanonicalTransactionChain {

    /**********
     * Events *
     **********/

    event TransactionEnqueued(
        address _l1TxOrigin,
        address _target,
        uint256 _gasLimit,
        bytes _data,
        uint256 _queueIndex,
        uint256 _timestamp
    );

    event SequencerBatchAppended();

    event TransactionBatchAppended(
        uint256 indexed _batchIndex,
        bytes32 _batchRoot,
        uint256 _batchSize,
        uint256 _prevTotalElements,
        bytes _extraData
    );


    /***********
     * Structs *
     ***********/

    struct BatchContext {
        uint256 numSequencedTransactions;
        uint256 numSubsequentQueueTransactions;
        uint256 timestamp;
        uint256 blockNumber;
    }


    /********************
     * Public Functions *
     ********************/


    /**
     * Accesses the batch storage container.
     * @return Reference to the batch storage container.
     */
    function batches()
        external
        view
        returns (
            iOVM_ChainStorageContainer
        );

    /**
     * Accesses the queue storage container.
     * @return Reference to the queue storage container.
     */
    function queue()
        external
        view
        returns (
            iOVM_ChainStorageContainer
        );

    /**
     * Retrieves the total number of elements submitted.
     * @return _totalElements Total submitted elements.
     */
    function getTotalElements()
        external
        view
        returns (
            uint256 _totalElements
        );

    /**
     * Retrieves the total number of batches submitted.
     * @return _totalBatches Total submitted batches.
     */
    function getTotalBatches()
        external
        view
        returns (
            uint256 _totalBatches
        );

    /**
     * Gets the queue element at a particular index.
     * @param _index Index of the queue element to access.
     * @return _element Queue element at the given index.
     */
    function getQueueElement(
        uint256 _index
    )
        external
        view
        returns (
            Lib_OVMCodec.QueueElement memory _element
        );

    /**
     * Returns the timestamp of the last transaction.
     * @return Timestamp for the last transaction.
     */
    function getLastTimestamp()
        external
        view
        returns (
            uint40
        );

    /**
     * Returns the blocknumber of the last transaction.
     * @return Blocknumber for the last transaction.
     */
    function getLastBlockNumber()
        external
        view
        returns (
            uint40
        );

    /**
     * Retrieves the length of the queue, including
     * both pending and canonical transactions.
     * @return Length of the queue.
     */
    function getQueueLength()
        external
        view
        returns (
            uint40
        );


    /**
     * Adds a transaction to the queue.
     * @param _target Target contract to send the transaction to.
     * @param _gasLimit Gas limit for the given transaction.
     * @param _data Transaction data.
     */
    function enqueue(
        address _target,
        uint256 _gasLimit,
        bytes memory _data
    )
        external;

    /**
     * Allows the sequencer to append a batch.
     * @param _shouldStartAtElement Specific batch we expect to start appending to.
     * @param _blocks All blocks to append.
     */
    function appendSequencerBatch(
        uint40 _shouldStartAtElement,
        bytes[] memory _blocks
    )
        external;

    /**
     * Verifies whether a transaction is included in the chain.
     * @param _transaction Transaction to verify.
     * @param _txChainElement Transaction chain element corresponding to the transaction.
     * @param _batchHeader Header of the batch the transaction was included in.
     * @param _inclusionProof Inclusion proof for the provided transaction chain element.
     * @return True if the transaction exists in the CTC, false if not.
     */
    function verifyTransaction(
        Lib_OVMCodec.Transaction memory _transaction,
        Lib_OVMCodec.TransactionChainElement memory _txChainElement,
        Lib_OVMCodec.ChainBatchHeader memory _batchHeader,
        Lib_OVMCodec.ChainInclusionProof memory _inclusionProof
    )
        external
        view
        returns (
            bool
        );
}
