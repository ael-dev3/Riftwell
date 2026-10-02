// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @notice Independently written declarations for the public KittenSwap HyperEVM ABI.
/// @dev ABI compatibility is evidenced in docs/kitten-integration.md. These declarations
/// do not establish reward-recipient or authorization semantics, which require a fork
/// test against the pinned deployment before a funded launch.
interface IKittenVotingEscrow {
    function ownerOf(uint256 tokenId) external view returns (address);
    function getApproved(uint256 tokenId) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
    function isApprovedOrOwner(address account, uint256 tokenId) external view returns (bool);
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
    function transferFrom(address from, address to, uint256 tokenId) external;
    function locked(uint256 tokenId) external view returns (int128 amount, uint256 end);
    function balanceOfNFT(uint256 tokenId) external view returns (uint256);
    function ownership_change(uint256 tokenId) external view returns (uint256);
    function voted(uint256 tokenId) external view returns (bool);
    function MAXTIME() external view returns (uint256);
    function voter() external view returns (address);
    function kitten() external view returns (address);
}

interface IKittenVoter {
    struct Gauge {
        address gauge;
        bool isAlgebra;
        address votingReward;
        bool isAlive;
        address vault;
    }

    function veKitten() external view returns (address);
    function getCurrentPeriod() external view returns (uint256);
    function getGauge(address pool) external view returns (Gauge memory);
    function checkPeriodVoted(uint256 period, uint256 tokenId) external view returns (bool);
    function getTokenIdVotes(uint256 period, uint256 tokenId)
        external
        view
        returns (address[] memory pools, uint256[] memory weights);
    function vote(uint256 tokenId, address[] calldata pools, uint256[] calldata weights) external;
    function claimVotingRewardBatch(address[] calldata votingRewards, uint256 tokenId) external;
}

/// @notice Voting rewards have a different ABI from common Solidly getReward contracts.
interface IKittenVotingReward {
    function veKitten() external view returns (address);
    function voter() external view returns (address);
    function getRewardForTokenId(uint256 tokenId) external;
    function getRewardForOwner(uint256 tokenId) external;
    function getRewardForPeriod(uint256 period, uint256 tokenId, address token) external;
    function earnedForPeriod(uint256 period, uint256 tokenId, address token)
        external
        view
        returns (uint256);
    function earnedForToken(uint256 tokenId, address token) external view returns (uint256);
    function earnedForTokenId(uint256 tokenId)
        external
        view
        returns (uint256[] memory amounts, address[] memory tokens);
    function getRewardList() external view returns (address[] memory);
}
