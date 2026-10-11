// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Message} from "@kleros/veashi-sdk/contracts/interfaces/IMessage.sol";
import {IReporter} from "@kleros/veashi-sdk/contracts/interfaces/IReporter.sol";
import {IAdapter} from "@kleros/veashi-sdk/contracts/interfaces/IAdapter.sol";

/// @dev Devnet-only Yaho: keeps the call shape the gateways use (`dispatchMessageToAdapters`) and Hashi's message
/// hashing and ID scheme, and hands the message to every reporter, which pays its own bridge fee.
contract MockYaho {
    error NoReportersGiven();
    error NoAdaptersGiven();
    error UnequalArrayLengths(uint256 arrayOne, uint256 arrayTwo);
    error InvalidThreshold(uint256 threshold, uint256 maxThreshold);

    event MessageDispatched(uint256 indexed messageId, Message message);

    uint256 public currentNonce;
    mapping(uint256 messageId => bytes32) public pendingMessageHashes;

    function dispatchMessageToAdapters(
        uint256 targetChainId,
        uint256 threshold,
        address receiver,
        bytes calldata data,
        IReporter[] calldata reporters,
        IAdapter[] calldata adapters
    ) external payable returns (uint256 messageId, bytes32[] memory reportersReceipts) {
        if (reporters.length == 0) revert NoReportersGiven();
        if (adapters.length == 0) revert NoAdaptersGiven();
        if (reporters.length != adapters.length) revert UnequalArrayLengths(reporters.length, adapters.length);
        if (threshold == 0 || threshold > reporters.length) revert InvalidThreshold(threshold, reporters.length);

        Message memory message = Message(
            currentNonce++,
            targetChainId,
            threshold,
            msg.sender,
            receiver,
            data,
            reporters,
            adapters
        );
        bytes32 messageHash = calculateMessageHash(message);
        messageId = calculateMessageId(block.chainid, address(this), messageHash);
        pendingMessageHashes[messageId] = messageHash;

        uint256[] memory messageIds = new uint256[](1);
        bytes32[] memory messageHashes = new bytes32[](1);
        messageIds[0] = messageId;
        messageHashes[0] = messageHash;
        reportersReceipts = new bytes32[](reporters.length);
        for (uint256 i = 0; i < reporters.length; i++) {
            reportersReceipts[i] = reporters[i].dispatchMessages(targetChainId, adapters[i], messageIds, messageHashes);
        }
        emit MessageDispatched(messageId, message);
    }

    function getPendingMessageHash(uint256 messageId) external view returns (bytes32) {
        return pendingMessageHashes[messageId];
    }

    function calculateMessageHash(Message memory message) public pure returns (bytes32) {
        return keccak256(abi.encode(message));
    }

    function calculateMessageId(
        uint256 sourceChainId,
        address dispatcherAddress,
        bytes32 messageHash
    ) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(sourceChainId, dispatcherAddress, messageHash)));
    }
}
