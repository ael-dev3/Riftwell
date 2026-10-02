// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

/// @dev Records the precise rejection of a nested financed purchase.
contract FinancedSaleReenteringReceiver is IERC721Receiver {
    address public immutable loans;
    uint256 public targetListing;
    bool public reentrySucceeded;
    bytes public reentryReturnData;

    constructor(address manager) { loans = manager; }
    function setTarget(uint256 id) external { targetListing = id; }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        (reentrySucceeded, reentryReturnData) = loans.call(
            abi.encodeWithSignature("buyFinancedCollateral(uint256,uint256,address)", targetListing, type(uint256).max, address(this))
        );
        return IERC721Receiver.onERC721Received.selector;
    }
}
