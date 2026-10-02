// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {MarketTestNFT} from "./MarketMocks.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IKittenVoter} from "../interfaces/IKittenVoting.sol";

contract LoanTestNFT is MarketTestNFT {
    struct Lock { int128 amount; uint256 end; }
    mapping(uint256 => Lock) public locked;
    function setLock(uint256 id, int128 amount, uint256 end) external { locked[id] = Lock(amount, end); }
    function balanceOfNFT(uint256 id) external view returns (uint256) {
        Lock memory l = locked[id];
        return l.amount > 0 && l.end > block.timestamp ? uint128(l.amount) * (l.end - block.timestamp) / (730 days) : 0;
    }
}

contract LoanTestVoter {
    address public immutable veKitten;
    uint256 public getCurrentPeriod = 10;
    mapping(address => IKittenVoter.Gauge) private gauges;
    mapping(uint256 => uint256) public voteCount;
    constructor(address nft) { veKitten = nft; }
    function getGauge(address pool) external view returns (IKittenVoter.Gauge memory) { return gauges[pool]; }
    function setGauge(address pool, address reward) external { gauges[pool] = IKittenVoter.Gauge(address(0), false, reward, true, address(0)); }
    function setPeriod(uint256 period) external { getCurrentPeriod = period; }
    function vote(uint256 tokenId, address[] calldata pools, uint256[] calldata weights) external {
        require(LoanTestNFT(veKitten).ownerOf(tokenId) == msg.sender, "owner required");
        require(pools.length == weights.length && pools.length > 0, "bad vote");
        voteCount[tokenId]++;
        LoanTestNFT(veKitten).setTransferBlocked(tokenId, true);
    }
}

contract LoanTestReward {
    address public immutable voter;
    address public immutable veKitten;
    mapping(bytes32 => uint256) public payableReward;
    constructor(address voter_, address nft_) { voter = voter_; veKitten = nft_; }
    function setReward(uint256 period, uint256 id, address token, uint256 amount) external { payableReward[keccak256(abi.encode(period, id, token))] = amount; }
    function getRewardForPeriod(uint256 period, uint256 id, address token) external {
        address owner = LoanTestNFT(veKitten).ownerOf(id);
        require(owner == msg.sender, "owner required");
        bytes32 key = keccak256(abi.encode(period, id, token));
        uint256 amount = payableReward[key];
        payableReward[key] = 0;
        require(IERC20(token).transfer(owner, amount), "reward transfer");
    }
}
