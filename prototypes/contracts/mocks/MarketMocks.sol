// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Test fixtures only; unrestricted minting and toggles are intentional.
contract MarketTestNFT is ERC721 {
    mapping(uint256 => bool) public voted;
    mapping(uint256 => bool) public transferBlocked;

    constructor() ERC721("Test lock", "TLOCK") {}

    function mint(address to, uint256 tokenId) external { _mint(to, tokenId); }
    function setVoted(uint256 tokenId, bool value) external { voted[tokenId] = value; }
    function setTransferBlocked(uint256 tokenId, bool value) external {
        transferBlocked[tokenId] = value;
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (_ownerOf(tokenId) != address(0) && transferBlocked[tokenId]) revert("transfer blocked");
        return super._update(to, tokenId, auth);
    }
}

contract MarketTestUSDC is ERC20 {
    constructor() ERC20("Test USDC", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @dev Burns one percent on transfers to test exact-payment rejection.
contract MarketTaxUSDC is ERC20 {
    bool public selectiveTax;
    address public taxedSender;
    constructor() ERC20("Tax USDC", "TAX") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function setTaxedSender(address sender) external {
        selectiveTax = true;
        taxedSender = sender;
    }
    function _update(address from, address to, uint256 amount) internal override {
        if (from != address(0) && to != address(0) && (!selectiveTax || from == taxedSender)) {
            uint256 tax = amount / 100;
            if (tax != 0) super._update(from, address(0), tax);
            super._update(from, to, amount - tax);
        } else {
            super._update(from, to, amount);
        }
    }
}

contract MarketRejectingReceiver is IERC721Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        revert("no NFTs accepted");
    }
}

contract MarketReenteringReceiver is IERC721Receiver {
    address public immutable market;
    uint256 public targetListing;
    bool public reentrySucceeded;
    bytes public reentryReturnData;

    constructor(address marketAddress) { market = marketAddress; }
    function setTarget(uint256 listingId) external { targetListing = listingId; }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        (reentrySucceeded, reentryReturnData) = market.call(
            abi.encodeWithSignature("buy(uint256,uint256,address)", targetListing, type(uint256).max, address(this))
        );
        return IERC721Receiver.onERC721Received.selector;
    }
}
