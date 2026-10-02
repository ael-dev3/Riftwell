// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IKittenVotingEscrow, IKittenVoter} from "./interfaces/IKittenVoting.sol";
import {RiftwellLoanVault} from "./RiftwellLoanVault.sol";

/// @notice Lender-funded offers against a specific locked NFT; no pooled lender claims.
/// @dev Original local prototype. NFT custody continues until debt is repaid or forgiven.
/// Interest accrues on outstanding principal, ends at maturity, and never capitalizes.
/// A low platform fee does not include or guarantee the lender's return.
contract RiftwellLoans is ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant FEE_BPS = 50;
    uint256 public constant BPS = 10_000;
    uint256 public constant YEAR = 365 days;
    uint256 public constant MAX_APR_BPS = 100_000;
    uint256 private constant INTEREST_DENOMINATOR = BPS * YEAR;
    IKittenVotingEscrow public immutable collection;
    IERC20 public immutable settlementToken;
    IKittenVoter public immutable voter;
    address public immutable treasury;
    address public immutable guardian;
    bool public immutable claimsVerified;
    bool public newLoansPaused;

    struct Offer {
        address lender;
        address borrower;
        uint256 tokenId;
        uint128 principal;
        uint32 aprBps;
        uint32 duration;
        uint64 expiry;
        uint64 minimumLockEnd;
        uint128 minimumLockedAmount;
        bool active;
    }
    struct Loan {
        address lender;
        address borrower;
        address vault;
        uint256 tokenId;
        uint128 principal;
        uint32 aprBps;
        uint64 maturity;
        uint64 lastAccrued;
        uint256 accruedInterest;
        uint256 interestRemainder;
        bool active;
    }
    struct FinancedListing {
        uint256 loanId;
        uint256 price;
        uint64 expiry;
        bool active;
    }
    uint256 public offerCount;
    uint256 public loanCount;
    uint256 public financedListingCount;
    uint256 public escrowedOfferCapital;
    uint256 public totalLenderCredits;
    uint256 public totalBorrowerCredits;
    mapping(address => uint256) public lenderCredits;
    mapping(address => uint256) public borrowerCredits;
    mapping(uint256 => Offer) public offers;
    mapping(uint256 => Loan) public loans;
    mapping(uint256 => FinancedListing) public financedListings;
    mapping(uint256 => uint256) public activeFinancedListing;
    mapping(uint256 => uint256) public activeLoanForToken;

    error InvalidConfiguration();
    error InvalidTerms();
    error Unauthorized();
    error Paused();
    error InactiveOffer();
    error ExpiredOffer();
    error InvalidCollateral();
    error InactiveLoan();
    error ZeroPayment();
    error InexactPayment();
    error InvalidWithdrawal();
    error InactiveListing();
    error ExpiredListing();
    error PriceLimit();
    error InsufficientSaleProceeds();
    event OfferFunded(uint256 indexed offerId, address indexed lender, address indexed borrower, uint256 tokenId, uint256 principal, uint256 aprBps, uint256 duration);
    event OfferCancelled(uint256 indexed offerId);
    event LoanOpened(uint256 indexed loanId, uint256 indexed offerId, address indexed vault, uint256 protocolFee, uint256 borrowerProceeds, uint256 maturity);
    event Repaid(uint256 indexed loanId, address indexed payer, uint256 amount, uint256 interestPaid, uint256 principalPaid);
    event DebtForgiven(uint256 indexed loanId, uint256 principal, uint256 interest);
    event LoanClosed(uint256 indexed loanId);
    event CollateralWithdrawn(uint256 indexed loanId, address indexed recipient);
    event LenderCreditWithdrawn(address indexed lender, address indexed recipient, uint256 amount);
    event BorrowerCreditWithdrawn(address indexed borrower, address indexed recipient, uint256 amount);
    event FinancedCollateralListed(uint256 indexed listingId, uint256 indexed loanId, address indexed borrower, uint256 tokenId, uint256 price, uint256 expiry);
    event FinancedListingCancelled(uint256 indexed listingId);
    event FinancedCollateralSold(uint256 indexed listingId, uint256 indexed loanId, address indexed buyer, address recipient, uint256 price, uint256 debtPaid, uint256 protocolFee, uint256 borrowerProceeds);
    event NewLoansPaused(bool paused);

    constructor(address nft, address token, address voter_, address treasury_, address guardian_, bool claimsVerified_) {
        if (nft.code.length == 0 || token.code.length == 0 || voter_.code.length == 0 || treasury_ == address(0) || guardian_ == address(0) || treasury_ == address(this)) revert InvalidConfiguration();
        if (IKittenVoter(voter_).veKitten() != nft) revert InvalidConfiguration();
        collection = IKittenVotingEscrow(nft);
        settlementToken = IERC20(token);
        voter = IKittenVoter(voter_);
        treasury = treasury_;
        guardian = guardian_;
        claimsVerified = claimsVerified_;
    }

    function setNewLoansPaused(bool paused) external {
        if (msg.sender != guardian) revert Unauthorized();
        newLoansPaused = paused;
        emit NewLoansPaused(paused);
    }

    /// @notice Deposits actual loan capital for immutable terms and a specific borrower/NFT.
    /// @dev Lender chooses collateral limits; this contract does not invent an oracle or promise APR.
    function fundOffer(address borrower, uint256 tokenId, uint128 principal, uint32 aprBps, uint32 duration, uint64 expiry, uint64 minimumLockEnd, uint128 minimumLockedAmount) external nonReentrant returns (uint256 offerId) {
        if (newLoansPaused) revert Paused();
        if (borrower == address(0) || borrower == msg.sender || principal == 0 || aprBps > MAX_APR_BPS || duration == 0 || duration > YEAR || expiry <= block.timestamp || minimumLockedAmount == 0) revert InvalidTerms();
        if (collection.ownerOf(tokenId) != borrower) revert InvalidCollateral();
        _pullExact(msg.sender, principal);
        escrowedOfferCapital += principal;
        offerId = ++offerCount;
        offers[offerId] = Offer(msg.sender, borrower, tokenId, principal, aprBps, duration, expiry, minimumLockEnd, minimumLockedAmount, true);
        emit OfferFunded(offerId, msg.sender, borrower, tokenId, principal, aprBps, duration);
    }

    function cancelOffer(uint256 offerId) external nonReentrant {
        Offer storage offer = offers[offerId];
        if (msg.sender != offer.lender) revert Unauthorized();
        if (!offer.active) revert InactiveOffer();
        offer.active = false;
        escrowedOfferCapital -= offer.principal;
        lenderCredits[offer.lender] += offer.principal;
        totalLenderCredits += offer.principal;
        emit OfferCancelled(offerId);
    }

    /// @notice Repayments and offer refunds are credited before withdrawal, so an
    /// unusable lender destination cannot prevent a borrower from closing a loan.
    function withdrawLenderCredit(address recipient, uint256 amount) external nonReentrant {
        if (recipient == address(0) || recipient == address(this) || amount == 0 || amount > lenderCredits[msg.sender]) revert InvalidWithdrawal();
        lenderCredits[msg.sender] -= amount;
        totalLenderCredits -= amount;
        _payExact(recipient, amount);
        emit LenderCreditWithdrawn(msg.sender, recipient, amount);
    }

    /// @notice Sale proceeds are a separate, fully funded borrower liability.
    /// A frozen borrower destination cannot prevent sale settlement or debt closure.
    function withdrawBorrowerCredit(address recipient, uint256 amount) external nonReentrant {
        if (recipient == address(0) || recipient == address(this) || amount == 0 || amount > borrowerCredits[msg.sender]) revert InvalidWithdrawal();
        borrowerCredits[msg.sender] -= amount;
        totalBorrowerCredits -= amount;
        _payExact(recipient, amount);
        emit BorrowerCreditWithdrawn(msg.sender, recipient, amount);
    }

    function acceptOffer(uint256 offerId) external nonReentrant returns (uint256 loanId) {
        if (newLoansPaused) revert Paused();
        Offer storage offer = offers[offerId];
        if (!offer.active) revert InactiveOffer();
        if (msg.sender != offer.borrower) revert Unauthorized();
        if (block.timestamp >= offer.expiry) revert ExpiredOffer();
        if (collection.ownerOf(offer.tokenId) != msg.sender || activeLoanForToken[offer.tokenId] != 0) revert InvalidCollateral();
        (int128 lockedAmount, uint256 lockEnd) = collection.locked(offer.tokenId);
        uint256 maturity = block.timestamp + offer.duration;
        if (lockedAmount <= 0 || uint128(lockedAmount) < offer.minimumLockedAmount || lockEnd < offer.minimumLockEnd || lockEnd < maturity) revert InvalidCollateral();
        offer.active = false;
        escrowedOfferCapital -= offer.principal;
        loanId = ++loanCount;
        RiftwellLoanVault vault = new RiftwellLoanVault(msg.sender, address(collection), address(settlementToken), address(voter), offer.tokenId, loanId, claimsVerified);
        loans[loanId] = Loan(offer.lender, msg.sender, address(vault), offer.tokenId, offer.principal, offer.aprBps, uint64(maturity), uint64(block.timestamp), 0, 0, true);
        activeLoanForToken[offer.tokenId] = loanId;
        IERC721(address(collection)).safeTransferFrom(msg.sender, address(vault), offer.tokenId);
        if (collection.ownerOf(offer.tokenId) != address(vault)) revert InvalidCollateral();
        uint256 fee = uint256(offer.principal) * FEE_BPS / BPS;
        _payExact(msg.sender, uint256(offer.principal) - fee);
        if (fee != 0) _payExact(treasury, fee);
        emit LoanOpened(loanId, offerId, address(vault), fee, uint256(offer.principal) - fee, maturity);
    }

    function debt(uint256 loanId) public view returns (uint256 principal, uint256 interest, uint256 total) {
        Loan storage loan = loans[loanId];
        principal = loan.principal;
        uint256 until = block.timestamp < loan.maturity ? block.timestamp : loan.maturity;
        uint256 numerator = loan.interestRemainder;
        if (loan.active && until > loan.lastAccrued) numerator += principal * loan.aprBps * (until - loan.lastAccrued);
        interest = loan.accruedInterest + numerator / INTEREST_DENOMINATOR;
        total = principal + interest;
    }

    function isLoanActive(uint256 loanId) external view returns (bool) { return loans[loanId].active; }

    /// @notice The borrower can sell active collateral without an external party
    /// ever receiving an approval to remove it. Every replacement gets a new ID.
    /// @dev Price is fixed; accrued debt and transfer eligibility are rechecked on purchase.
    function listFinancedCollateral(uint256 loanId, uint256 price, uint64 expiry) external nonReentrant returns (uint256 listingId) {
        Loan storage loan = _active(loanId);
        if (msg.sender != loan.borrower) revert Unauthorized();
        if (price == 0 || expiry <= block.timestamp) revert InvalidTerms();
        if (collection.ownerOf(loan.tokenId) != loan.vault) revert InvalidCollateral();
        _cancelFinancedListing(loanId);
        listingId = ++financedListingCount;
        financedListings[listingId] = FinancedListing(loanId, price, expiry, true);
        activeFinancedListing[loanId] = listingId;
        emit FinancedCollateralListed(listingId, loanId, loan.borrower, loan.tokenId, price, expiry);
    }

    function cancelFinancedListing(uint256 listingId) external nonReentrant {
        FinancedListing storage listing = financedListings[listingId];
        if (!listing.active || activeFinancedListing[listing.loanId] != listingId) revert InactiveListing();
        if (msg.sender != loans[listing.loanId].borrower) revert Unauthorized();
        _cancelFinancedListing(listing.loanId);
    }

    /// @notice Buyer pays a fixed price, the lender's debt is funded first, and
    /// the NFT moves directly from custody to the chosen buyer recipient.
    /// @dev One 0.5% sale fee. No new origination fee or lender reward haircut.
    /// If Kitten rejects the NFT transfer, all payments and debt changes revert.
    function buyFinancedCollateral(uint256 listingId, uint256 maximumPrice, address recipient) external nonReentrant {
        FinancedListing storage listing = financedListings[listingId];
        if (!listing.active || activeFinancedListing[listing.loanId] != listingId) revert InactiveListing();
        if (block.timestamp >= listing.expiry) revert ExpiredListing();
        if (listing.price > maximumPrice) revert PriceLimit();
        Loan storage loan = _active(listing.loanId);
        if (recipient == address(0) || recipient == address(this) || recipient == loan.vault) revert InvalidCollateral();
        if (collection.ownerOf(loan.tokenId) != loan.vault) revert InvalidCollateral();
        _accrue(loan);
        uint256 debtPaid = uint256(loan.principal) + loan.accruedInterest;
        uint256 price = listing.price;
        uint256 fee = price / BPS * FEE_BPS + price % BPS * FEE_BPS / BPS;
        if (price - fee < debtPaid) revert InsufficientSaleProceeds();
        uint256 borrowerProceeds = price - fee - debtPaid;
        // Effects precede token/NFT callbacks; the reentrancy guard covers settlement.
        listing.active = false;
        delete activeFinancedListing[listing.loanId];
        _pullExact(msg.sender, price);
        _applyPayment(listing.loanId, loan, debtPaid, msg.sender);
        borrowerCredits[loan.borrower] += borrowerProceeds;
        totalBorrowerCredits += borrowerProceeds;
        if (fee != 0) _payExact(treasury, fee);
        RiftwellLoanVault(loan.vault).releaseCollateral(recipient);
        emit CollateralWithdrawn(listing.loanId, recipient);
        emit FinancedCollateralSold(listingId, listing.loanId, msg.sender, recipient, price, debtPaid, fee, borrowerProceeds);
    }

    /// @notice Repayment remains possible even if Kitten temporarily blocks the NFT transfer.
    /// Once repaid, voting is frozen; the borrower can withdraw when the collection permits it.
    function withdrawCollateral(uint256 loanId, address recipient) external nonReentrant {
        Loan storage loan = loans[loanId];
        if (msg.sender != loan.borrower || loan.vault == address(0)) revert Unauthorized();
        if (loan.active) revert InvalidCollateral();
        RiftwellLoanVault(loan.vault).releaseCollateral(recipient);
        emit CollateralWithdrawn(loanId, recipient);
    }

    /// @notice Any payer may repay; only funds actually needed are pulled.
    function repay(uint256 loanId, uint256 maximumAmount) external nonReentrant returns (uint256 paid) {
        Loan storage loan = _active(loanId);
        _accrue(loan);
        uint256 total = uint256(loan.principal) + loan.accruedInterest;
        paid = maximumAmount < total ? maximumAmount : total;
        if (paid == 0) revert ZeroPayment();
        _pullExact(msg.sender, paid);
        _applyPayment(loanId, loan, paid, msg.sender);
    }

    /// @notice A keeper can turn USDC already held by the custody vault into repayment.
    /// @dev No platform reward share or keeper surcharge. Non-USDC swaps need a separate reviewed adapter.
    function repayFromRewards(uint256 loanId) external nonReentrant returns (uint256 paid) {
        Loan storage loan = _active(loanId);
        _accrue(loan);
        uint256 available = settlementToken.balanceOf(loan.vault);
        uint256 total = uint256(loan.principal) + loan.accruedInterest;
        paid = available < total ? available : total;
        if (paid == 0) revert ZeroPayment();
        RiftwellLoanVault(loan.vault).takeSettlement(paid);
        _applyPayment(loanId, loan, paid, loan.vault);
    }

    /// @notice Lender may explicitly forgive a loss; this never transfers NFT ownership to the lender.
    function forgiveDebt(uint256 loanId) external nonReentrant {
        Loan storage loan = _active(loanId);
        if (msg.sender != loan.lender) revert Unauthorized();
        _accrue(loan);
        emit DebtForgiven(loanId, loan.principal, loan.accruedInterest);
        loan.principal = 0;
        loan.accruedInterest = 0;
        loan.interestRemainder = 0;
        _close(loanId, loan);
    }

    function _active(uint256 loanId) private view returns (Loan storage loan) {
        loan = loans[loanId];
        if (!loan.active) revert InactiveLoan();
    }
    function _accrue(Loan storage loan) private {
        uint256 until = block.timestamp < loan.maturity ? block.timestamp : loan.maturity;
        uint256 numerator = loan.interestRemainder;
        if (until > loan.lastAccrued) {
            numerator += uint256(loan.principal) * loan.aprBps * (until - loan.lastAccrued);
            loan.lastAccrued = uint64(until);
        }
        loan.accruedInterest += numerator / INTEREST_DENOMINATOR;
        loan.interestRemainder = numerator % INTEREST_DENOMINATOR;
    }
    function _applyPayment(uint256 loanId, Loan storage loan, uint256 paid, address payer) private {
        uint256 interestPaid = paid < loan.accruedInterest ? paid : loan.accruedInterest;
        uint256 principalPaid = paid - interestPaid;
        loan.accruedInterest -= interestPaid;
        loan.principal -= uint128(principalPaid);
        lenderCredits[loan.lender] += paid;
        totalLenderCredits += paid;
        emit Repaid(loanId, payer, paid, interestPaid, principalPaid);
        if (loan.principal == 0 && loan.accruedInterest == 0) _close(loanId, loan);
    }
    function _close(uint256 loanId, Loan storage loan) private {
        loan.active = false;
        loan.interestRemainder = 0;
        delete activeLoanForToken[loan.tokenId];
        _cancelFinancedListing(loanId);
        emit LoanClosed(loanId);
    }
    function _cancelFinancedListing(uint256 loanId) private {
        uint256 listingId = activeFinancedListing[loanId];
        if (listingId == 0) return;
        financedListings[listingId].active = false;
        delete activeFinancedListing[loanId];
        emit FinancedListingCancelled(listingId);
    }
    function _pullExact(address from, uint256 amount) private {
        uint256 beforeContract = settlementToken.balanceOf(address(this));
        uint256 beforeSender = settlementToken.balanceOf(from);
        settlementToken.safeTransferFrom(from, address(this), amount);
        if (settlementToken.balanceOf(address(this)) != beforeContract + amount || settlementToken.balanceOf(from) != beforeSender - amount) revert InexactPayment();
    }
    function _payExact(address to, uint256 amount) private {
        uint256 beforeRecipient = settlementToken.balanceOf(to);
        uint256 beforeContract = settlementToken.balanceOf(address(this));
        settlementToken.safeTransfer(to, amount);
        if (settlementToken.balanceOf(to) != beforeRecipient + amount || settlementToken.balanceOf(address(this)) != beforeContract - amount) revert InexactPayment();
    }
}
