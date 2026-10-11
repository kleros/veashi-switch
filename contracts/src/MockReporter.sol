// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAdapter} from "@kleros/veashi-sdk/contracts/interfaces/IAdapter.sol";

/// @dev Devnet-only reporter for one oracle on one chain. It pays a fixed bridge fee per message from its own balance
/// (as real reporters do), so an unfunded reporter makes the dispatch revert. The relayer picks its
/// `MessageDispatched` events up and stores the hash in the paired adapter on the other chain.
contract MockReporter {
    error NotYaho(address sender, address expectedYaho);
    error ReporterCannotPay(string oracle, uint256 required, uint256 available);

    event MessageDispatched(
        uint256 indexed targetChainId,
        IAdapter adapter,
        uint256 indexed messageId,
        bytes32 messageHash
    );

    address public immutable yaho;
    string public name;
    uint256 public bridgeFee;
    address public immutable owner;

    constructor(address _yaho, string memory _name, uint256 _bridgeFee) {
        yaho = _yaho;
        name = _name;
        bridgeFee = _bridgeFee;
        owner = msg.sender;
    }

    receive() external payable {}

    function setBridgeFee(uint256 _bridgeFee) external {
        require(msg.sender == owner, "owner only");
        bridgeFee = _bridgeFee;
    }

    /// @dev Lets the devnet drain the reporter to show the "reporter cannot pay" failure.
    function withdraw(uint256 _amount) external {
        require(msg.sender == owner, "owner only");
        payable(owner).transfer(_amount);
    }

    function dispatchMessages(
        uint256 targetChainId,
        IAdapter adapter,
        uint256[] memory messageIds,
        bytes32[] memory messageHashes
    ) external payable returns (bytes32) {
        if (msg.sender != yaho) revert NotYaho(msg.sender, yaho);
        uint256 fee = bridgeFee * messageIds.length;
        if (address(this).balance < fee) revert ReporterCannotPay(name, fee, address(this).balance);
        if (fee > 0) payable(address(0xFEE)).transfer(fee); // The bridge's fee, burnt on the devnet.
        for (uint256 i = 0; i < messageIds.length; i++) {
            emit MessageDispatched(targetChainId, adapter, messageIds[i], messageHashes[i]);
        }
        return keccak256(abi.encode(targetChainId, adapter, messageIds, messageHashes));
    }
}
