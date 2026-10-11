// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Devnet-only adapter for one oracle on one chain: the relayer account (standing in for the bridge)
/// stores each message hash reported by the paired reporter on the other chain, one oracle at a time.
contract MockAdapter {
    error RelayerOnly();
    error ConflictingHash(uint256 domain, uint256 id, bytes32 hash, bytes32 storedHash);

    event HashStored(uint256 indexed id, bytes32 indexed hash);

    string public name;
    address public immutable relayer;
    mapping(uint256 domain => mapping(uint256 id => bytes32)) private hashes;

    constructor(string memory _name, address _relayer) {
        name = _name;
        relayer = _relayer;
    }

    function storeHash(uint256 domain, uint256 id, bytes32 hash) external {
        if (msg.sender != relayer) revert RelayerOnly();
        bytes32 stored = hashes[domain][id];
        if (stored != bytes32(0) && stored != hash) revert ConflictingHash(domain, id, hash, stored);
        hashes[domain][id] = hash;
        emit HashStored(id, hash);
    }

    function getHash(uint256 domain, uint256 id) external view returns (bytes32) {
        return hashes[domain][id];
    }
}
