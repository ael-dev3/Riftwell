// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {MarketTestUSDC} from "./MarketMocks.sol";

/// @dev Test-only stand-in for externally imposed stablecoin address freezes.
contract LoanBlacklistUSDC is MarketTestUSDC {
    mapping(address => bool) public blacklisted;

    function setBlacklisted(address account, bool value) external {
        blacklisted[account] = value;
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (from != address(0) && to != address(0)) {
            require(!blacklisted[from] && !blacklisted[to], "address frozen");
        }
        super._update(from, to, amount);
    }
}
