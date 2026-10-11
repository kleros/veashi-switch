// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Devnet-only USDC stand-in: 6 decimals, the deployer mints freely.
contract MockUSDC is ERC20 {
    address public immutable minter;

    constructor() ERC20("USD Coin (devnet)", "USDC") {
        minter = msg.sender;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address _to, uint256 _amount) external {
        require(msg.sender == minter, "minter only");
        _mint(_to, _amount);
    }
}
