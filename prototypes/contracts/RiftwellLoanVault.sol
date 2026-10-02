// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IKittenVoter, IKittenVotingReward} from "./interfaces/IKittenVoting.sol";

interface IRiftwellLoanState {
    function isLoanActive(uint256 loanId) external view returns (bool);
}

/// @notice A single loan's isolated NFT custody and typed voting integration.
/// @dev No arbitrary calls, external token approvals, upgrade path or administrator withdrawal.
contract RiftwellLoanVault is IERC721Receiver, ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public immutable manager;
    address public immutable borrower;
    IERC721 public immutable collection;
    IERC20 public immutable settlementToken;
    IKittenVoter public immutable voter;
    uint256 public immutable tokenId;
    uint256 public immutable loanId;
    bool public immutable claimsVerified;
    address public operator;
    bool private received;

    error Unauthorized();
    error InvalidTransfer();
    error LoanStillActive();
    error InvalidVote();
    error UnverifiedClaims();
    error InvalidReward();
    error ActivePeriod();
    error InexactTransfer();
    event OperatorChanged(address indexed operator);
    event Voted(uint256 indexed tokenId);
    event ClosedPeriodClaimed(address indexed pool, address indexed token, uint256 indexed period);

    constructor(address borrower_, address collection_, address token_, address voter_, uint256 tokenId_, uint256 loanId_, bool claimsVerified_) {
        manager = msg.sender;
        borrower = borrower_;
        collection = IERC721(collection_);
        settlementToken = IERC20(token_);
        voter = IKittenVoter(voter_);
        tokenId = tokenId_;
        loanId = loanId_;
        claimsVerified = claimsVerified_;
    }

    modifier authorized() {
        if (msg.sender != borrower && msg.sender != operator) revert Unauthorized();
        _;
    }
    modifier onlyManager() {
        if (msg.sender != manager) revert Unauthorized();
        _;
    }

    function setOperator(address operator_) external {
        if (msg.sender != borrower) revert Unauthorized();
        operator = operator_;
        emit OperatorChanged(operator_);
    }

    function vote(address[] calldata pools, uint256[] calldata weights) external authorized nonReentrant {
        if (!IRiftwellLoanState(manager).isLoanActive(loanId) || pools.length == 0 || pools.length != weights.length || collection.ownerOf(tokenId) != address(this)) revert InvalidVote();
        voter.vote(tokenId, pools, weights);
        emit Voted(tokenId);
    }

    /// @notice Claims an explicitly closed voting period from the pool's registered reward contract.
    /// @dev Deployment must keep claimsVerified=false until the exact live recipient semantics
    /// and adapter have passed fork tests and integration review. No current-period batch claim.
    function claimClosedPeriod(address pool, uint256 period, address token) external nonReentrant {
        if (!claimsVerified) revert UnverifiedClaims();
        if (period >= voter.getCurrentPeriod()) revert ActivePeriod();
        address reward = voter.getGauge(pool).votingReward;
        if (reward.code.length == 0 || token.code.length == 0) revert InvalidReward();
        if (IKittenVotingReward(reward).voter() != address(voter) || IKittenVotingReward(reward).veKitten() != address(collection)) revert InvalidReward();
        IKittenVotingReward(reward).getRewardForPeriod(period, tokenId, token);
        emit ClosedPeriodClaimed(pool, token, period);
    }

    function takeSettlement(uint256 amount) external onlyManager nonReentrant {
        uint256 beforeManager = settlementToken.balanceOf(manager);
        uint256 beforeVault = settlementToken.balanceOf(address(this));
        settlementToken.safeTransfer(manager, amount);
        if (settlementToken.balanceOf(manager) != beforeManager + amount || settlementToken.balanceOf(address(this)) != beforeVault - amount) revert InexactTransfer();
    }

    function releaseCollateral(address recipient) external onlyManager nonReentrant {
        if (IRiftwellLoanState(manager).isLoanActive(loanId)) revert LoanStillActive();
        if (recipient == address(0) || recipient == address(this) || recipient == manager) revert InvalidTransfer();
        collection.safeTransferFrom(address(this), recipient, tokenId);
    }

    /// @notice Once the loan is closed, remaining reward tokens belong to the borrower.
    function withdrawSurplus(address token, address recipient) external nonReentrant {
        if (msg.sender != borrower || recipient == address(0) || recipient == address(this)) revert Unauthorized();
        if (IRiftwellLoanState(manager).isLoanActive(loanId)) revert LoanStillActive();
        IERC20 asset = IERC20(token);
        asset.safeTransfer(recipient, asset.balanceOf(address(this)));
    }

    function onERC721Received(address operator_, address from, uint256 id, bytes calldata) external returns (bytes4) {
        if (msg.sender != address(collection) || operator_ != manager || from != borrower || id != tokenId || received) revert InvalidTransfer();
        received = true;
        return IERC721Receiver.onERC721Received.selector;
    }
}
