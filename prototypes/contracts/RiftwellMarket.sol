// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Fixed-collection, noncustodial NFT sale orders with a 0.5% seller fee.
/// @dev Local prototype. Collection transfer rules remain authoritative: a past
///      voting flag alone is deliberately not interpreted as a transfer ban.
///      Listing IDs never change their price or seller. A newly created listing
///      supersedes the previous listing for that token; sellers may also revoke
///      all their outstanding listings by incrementing their listing nonce.
///      ERC721 does not expose ownership history: an uncancelled, unexpired order
///      can become valid again if its seller reacquires the NFT and approval.
///      Sellers should cancel or invalidate orders before transferring away.
contract RiftwellMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant FEE_BPS = 50;
    uint256 public constant BPS = 10_000;

    IERC721 public immutable collection;
    IERC20 public immutable paymentToken;
    address public immutable treasury;

    struct Listing {
        address seller;
        uint256 tokenId;
        uint256 price;
        uint256 expiry;
        uint256 sellerNonce;
        bool active;
    }

    uint256 public listingCount;
    mapping(uint256 => Listing) public listings;
    mapping(uint256 => uint256) public currentListing;
    mapping(address => uint256) public sellerNonces;

    error InvalidConfiguration();
    error InvalidPriceOrExpiry();
    error NotOwner();
    error NotApproved();
    error NotSeller();
    error InactiveListing();
    error ExpiredListing();
    error PriceExceedsLimit();
    error InvalidRecipient();
    error InexactPayment();

    event Listed(
        uint256 indexed listingId,
        address indexed seller,
        uint256 indexed tokenId,
        uint256 price,
        uint256 expiry,
        uint256 sellerNonce
    );
    event ListingCancelled(uint256 indexed listingId);
    event SellerListingsInvalidated(address indexed seller, uint256 newNonce);
    event Purchased(
        uint256 indexed listingId,
        address indexed buyer,
        address indexed recipient,
        uint256 price,
        uint256 protocolFee
    );

    constructor(address nft, address token, address feeRecipient) {
        if (
            nft.code.length == 0 || token.code.length == 0 || feeRecipient == address(0)
                || feeRecipient == address(this)
        ) revert InvalidConfiguration();
        if (!IERC165(nft).supportsInterface(type(IERC721).interfaceId)) {
            revert InvalidConfiguration();
        }
        collection = IERC721(nft);
        paymentToken = IERC20(token);
        treasury = feeRecipient;
    }

    /// @notice The NFT stays in the seller's wallet until the purchase settles.
    function createListing(uint256 tokenId, uint256 price, uint256 expiry)
        external
        nonReentrant
        returns (uint256 listingId)
    {
        if (price == 0 || expiry <= block.timestamp) revert InvalidPriceOrExpiry();
        _checkSeller(tokenId, msg.sender);

        uint256 previous = currentListing[tokenId];
        if (previous != 0 && listings[previous].active) {
            listings[previous].active = false;
            emit ListingCancelled(previous);
        }
        listingId = ++listingCount;
        listings[listingId] = Listing({
            seller: msg.sender,
            tokenId: tokenId,
            price: price,
            expiry: expiry,
            sellerNonce: sellerNonces[msg.sender],
            active: true
        });
        currentListing[tokenId] = listingId;
        emit Listed(listingId, msg.sender, tokenId, price, expiry, sellerNonces[msg.sender]);
    }

    function cancelListing(uint256 listingId) external nonReentrant {
        Listing storage listing = listings[listingId];
        if (listing.seller != msg.sender) revert NotSeller();
        if (!listing.active) revert InactiveListing();
        listing.active = false;
        if (currentListing[listing.tokenId] == listingId) delete currentListing[listing.tokenId];
        emit ListingCancelled(listingId);
    }

    /// @notice Revokes all existing orders without having to enumerate them.
    function invalidateListings() external nonReentrant {
        uint256 newNonce = ++sellerNonces[msg.sender];
        emit SellerListingsInvalidated(msg.sender, newNonce);
    }

    /// @notice Pays exactly the listed price, including the seller's protocol fee.
    /// @param maxPrice Buyer protection against purchasing an unexpected order.
    /// @param recipient Destination that must accept the collection's safe transfer.
    function buy(uint256 listingId, uint256 maxPrice, address recipient) external nonReentrant {
        if (recipient == address(0) || recipient == address(this)) revert InvalidRecipient();
        Listing storage stored = listings[listingId];
        if (
            !stored.active || currentListing[stored.tokenId] != listingId
                || stored.sellerNonce != sellerNonces[stored.seller]
        ) revert InactiveListing();
        if (block.timestamp >= stored.expiry) revert ExpiredListing();
        if (stored.price > maxPrice) revert PriceExceedsLimit();
        _checkSeller(stored.tokenId, stored.seller);

        Listing memory listing = stored;
        stored.active = false;
        delete currentListing[listing.tokenId];
        uint256 fee = Math.mulDiv(listing.price, FEE_BPS, BPS);

        uint256 marketBalance = paymentToken.balanceOf(address(this));
        uint256 buyerBalance = paymentToken.balanceOf(msg.sender);
        paymentToken.safeTransferFrom(msg.sender, address(this), listing.price);
        if (
            paymentToken.balanceOf(address(this)) != marketBalance + listing.price
                || buyerBalance < listing.price
                || paymentToken.balanceOf(msg.sender) != buyerBalance - listing.price
        ) revert InexactPayment();

        // The actual NFT implementation decides whether this transfer is legal.
        // Any rejection (including a receiver callback) rolls back all payment.
        collection.safeTransferFrom(listing.seller, recipient, listing.tokenId);
        _payExact(listing.seller, listing.price - fee);
        if (fee != 0) _payExact(treasury, fee);
        if (paymentToken.balanceOf(address(this)) != marketBalance) revert InexactPayment();
        emit Purchased(listingId, msg.sender, recipient, listing.price, fee);
    }

    function _checkSeller(uint256 tokenId, address seller) private view {
        if (collection.ownerOf(tokenId) != seller) revert NotOwner();
        if (
            collection.getApproved(tokenId) != address(this)
                && !collection.isApprovedForAll(seller, address(this))
        ) revert NotApproved();
    }

    function _payExact(address recipient, uint256 amount) private {
        uint256 beforeRecipient = paymentToken.balanceOf(recipient);
        uint256 beforeMarket = paymentToken.balanceOf(address(this));
        paymentToken.safeTransfer(recipient, amount);
        if (
            paymentToken.balanceOf(recipient) != beforeRecipient + amount
                || beforeMarket < amount
                || paymentToken.balanceOf(address(this)) != beforeMarket - amount
        ) revert InexactPayment();
    }
}
