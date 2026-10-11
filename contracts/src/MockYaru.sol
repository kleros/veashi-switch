// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Message} from "@kleros/veashi-sdk/contracts/interfaces/IMessage.sol";
import {IAdapter} from "@kleros/veashi-sdk/contracts/interfaces/IAdapter.sol";
import {IJushin} from "@kleros/veashi-sdk/contracts/interfaces/IJushin.sol";

/// @dev Devnet-only Yaru for messages from one source chain's MockYaho. Like Hashi's Yaru it recomputes the message
/// ID, requires `threshold` of the message's adapters to hold the hash and calls `IJushin.onMessage` on the receiver.
/// Unlike it, a receiver revert is bubbled up unchanged so the app can explain it.
contract MockYaru {
    error InvalidToChainId(uint256 chainId, uint256 expectedChainId);
    error MessageIdAlreadyExecuted(uint256 messageId);
    error ThresholdNotMet(uint256 reported, uint256 threshold);
    error AlreadyInitialized();

    event MessageExecuted(uint256 indexed messageId, Message message);

    uint256 public immutable sourceChainId;
    address public sourceYaho;
    address private immutable deployer;
    mapping(uint256 messageId => bool) public executed;

    constructor(uint256 _sourceChainId) {
        sourceChainId = _sourceChainId;
        deployer = msg.sender;
    }

    /// @dev The source Yaho lives on the other chain and may be deployed after this contract.
    function setSourceYaho(address _sourceYaho) external {
        if (msg.sender != deployer || sourceYaho != address(0)) revert AlreadyInitialized();
        sourceYaho = _sourceYaho;
    }

    function executeMessages(Message[] calldata messages) external returns (bytes[] memory returnDatas) {
        returnDatas = new bytes[](messages.length);
        for (uint256 i = 0; i < messages.length; i++) {
            Message calldata message = messages[i];
            if (message.targetChainId != block.chainid) revert InvalidToChainId(message.targetChainId, block.chainid);
            bytes32 messageHash = keccak256(abi.encode(message));
            uint256 messageId = uint256(keccak256(abi.encode(sourceChainId, sourceYaho, messageHash)));
            if (executed[messageId]) revert MessageIdAlreadyExecuted(messageId);

            uint256 reported = reportedCount(messageId, messageHash, message.adapters);
            if (reported < message.threshold) revert ThresholdNotMet(reported, message.threshold);
            executed[messageId] = true;

            (bool success, bytes memory returnData) = message.receiver.call(
                abi.encodeCall(
                    IJushin.onMessage,
                    (messageId, sourceChainId, message.sender, message.threshold, message.adapters, message.data)
                )
            );
            if (!success) {
                assembly {
                    revert(add(returnData, 0x20), mload(returnData))
                }
            }
            returnDatas[i] = returnData;
            emit MessageExecuted(messageId, message);
        }
    }

    function reportedCount(
        uint256 messageId,
        bytes32 messageHash,
        IAdapter[] calldata adapters
    ) public view returns (uint256 count) {
        for (uint256 i = 0; i < adapters.length; i++) {
            if (adapters[i].getHash(sourceChainId, messageId) == messageHash) count++;
        }
    }
}
