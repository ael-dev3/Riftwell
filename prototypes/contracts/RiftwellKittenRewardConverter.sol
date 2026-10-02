// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev Original declarations for the observed Algebra Integral public ABI.
interface IRiftwellAlgebraRouter {
    struct ExactInputSingleParams {
        address tokenIn; address tokenOut; address deployer; address recipient;
        uint256 deadline; uint256 amountIn; uint256 amountOutMinimum; uint160 limitSqrtPrice;
    }
    struct ExactInputParams {
        bytes path; address recipient; uint256 deadline; uint256 amountIn; uint256 amountOutMinimum;
    }
    function factory() external view returns (address);
    function poolDeployer() external view returns (address);
    function WNativeToken() external view returns (address);
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256);
    function exactInput(ExactInputParams calldata params) external payable returns (uint256);
}
interface IRiftwellAlgebraFactory {
    function poolDeployer() external view returns (address);
    function poolByPair(address token0, address token1) external view returns (address);
}
interface IRiftwellAlgebraPool {
    function factory() external view returns (address);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function plugin() external view returns (address);
    function liquidity() external view returns (uint128);
}

/// @notice Bounded, caller-authorized conversion of liquid KITTEN or WHYPE into USDC.
/// @dev A reusable prototype component, not yet wired into collateral vaults.
/// No oracle: minimumOut is the caller's explicit economic instruction. Do not
/// expose unattended keeper execution until a reviewed consent/oracle policy exists.
contract RiftwellKittenRewardConverter is ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant MAX_DEADLINE_WINDOW = 5 minutes;
    struct Configuration {
        address router; address factory; address whype; address kitten; address usdc;
        address whypeUSDCPool; address kittenWHYPEPool;
        uint128 maxWHYPEInput; uint128 maxKITTENInput;
    }
    Configuration public configuration;
    uint256 public immutable deploymentChainId;
    bytes32 public immutable routerCodeHash;
    bytes32 public immutable factoryCodeHash;
    bytes32 public immutable whypePoolCodeHash;
    bytes32 public immutable kittenPoolCodeHash;
    address public immutable whypePlugin;
    address public immutable kittenPlugin;
    bytes32 public immutable whypePluginCodeHash;
    bytes32 public immutable kittenPluginCodeHash;

    error InvalidConfiguration();
    error DependencyChanged();
    error InvalidInstruction();
    error EmptyLiquidity();
    error InexactTransfer();
    error InexactSwap();
    event Converted(address indexed caller, address indexed inputToken, uint256 inputAmount, uint256 outputAmount, uint256 minimumOutput);

    constructor(Configuration memory c) {
        if (c.router.code.length == 0 || c.factory.code.length == 0 || c.whype.code.length == 0 ||
            c.kitten.code.length == 0 || c.usdc.code.length == 0 || c.whypeUSDCPool.code.length == 0 ||
            c.kittenWHYPEPool.code.length == 0 || c.maxWHYPEInput == 0 || c.maxKITTENInput == 0 ||
            c.whype == c.kitten || c.whype == c.usdc || c.kitten == c.usdc || c.whypeUSDCPool == c.kittenWHYPEPool)
            revert InvalidConfiguration();
        if (IERC20Metadata(c.whype).decimals() != 18 || IERC20Metadata(c.kitten).decimals() != 18 || IERC20Metadata(c.usdc).decimals() != 6)
            revert InvalidConfiguration();
        configuration = c;
        deploymentChainId = block.chainid;
        routerCodeHash = c.router.codehash;
        factoryCodeHash = c.factory.codehash;
        whypePoolCodeHash = c.whypeUSDCPool.codehash;
        kittenPoolCodeHash = c.kittenWHYPEPool.codehash;
        _checkRegistry(c);
        whypePlugin = IRiftwellAlgebraPool(c.whypeUSDCPool).plugin();
        kittenPlugin = IRiftwellAlgebraPool(c.kittenWHYPEPool).plugin();
        if (whypePlugin.code.length == 0 || kittenPlugin.code.length == 0) revert InvalidConfiguration();
        whypePluginCodeHash = whypePlugin.codehash;
        kittenPluginCodeHash = kittenPlugin.codehash;
    }

    /// @notice Recipient and spender are fixed by this code; caller supplies only
    /// an allowed input, capped amount, nonzero price floor and short deadline.
    function convert(address token, uint256 amount, uint256 minimumOut, uint256 deadline) external nonReentrant returns (uint256 output) {
        Configuration memory c = configuration;
        uint256 cap = token == c.whype ? c.maxWHYPEInput : token == c.kitten ? c.maxKITTENInput : 0;
        if (cap == 0 || amount == 0 || amount > cap || minimumOut == 0 || deadline < block.timestamp || deadline > block.timestamp + MAX_DEADLINE_WINDOW)
            revert InvalidInstruction();
        _checkDependencies(c, token);
        IERC20 input = IERC20(token);
        IERC20 usdc = IERC20(c.usdc);
        uint256 inputBefore = input.balanceOf(address(this));
        uint256 callerInputBefore = input.balanceOf(msg.sender);
        uint256 outputBefore = usdc.balanceOf(address(this));
        input.safeTransferFrom(msg.sender, address(this), amount);
        if (input.balanceOf(address(this)) != inputBefore + amount || input.balanceOf(msg.sender) != callerInputBefore - amount)
            revert InexactTransfer();
        input.forceApprove(c.router, amount);
        if (input.allowance(address(this), c.router) != amount) revert InexactTransfer();
        if (token == c.whype) {
            output = IRiftwellAlgebraRouter(c.router).exactInputSingle(IRiftwellAlgebraRouter.ExactInputSingleParams(
                token, c.usdc, address(0), address(this), deadline, amount, minimumOut, 0));
        } else {
            bytes memory route = abi.encodePacked(c.kitten, address(0), c.whype, address(0), c.usdc);
            output = IRiftwellAlgebraRouter(c.router).exactInput(IRiftwellAlgebraRouter.ExactInputParams(
                route, address(this), deadline, amount, minimumOut));
        }
        // Preserve pre-existing donations; neither they nor a router return value
        // can create repayment cash for this caller.
        if (input.balanceOf(address(this)) != inputBefore || output < minimumOut || usdc.balanceOf(address(this)) != outputBefore + output)
            revert InexactSwap();
        input.forceApprove(c.router, 0);
        if (input.allowance(address(this), c.router) != 0) revert InexactTransfer();
        uint256 callerOutputBefore = usdc.balanceOf(msg.sender);
        usdc.safeTransfer(msg.sender, output);
        if (usdc.balanceOf(msg.sender) != callerOutputBefore + output || usdc.balanceOf(address(this)) != outputBefore)
            revert InexactTransfer();
        emit Converted(msg.sender, token, amount, output, minimumOut);
    }

    function _checkDependencies(Configuration memory c, address token) private view {
        if (block.chainid != deploymentChainId || c.router.codehash != routerCodeHash || c.factory.codehash != factoryCodeHash ||
            c.whypeUSDCPool.codehash != whypePoolCodeHash || c.kittenWHYPEPool.codehash != kittenPoolCodeHash)
            revert DependencyChanged();
        _checkRegistry(c);
        if (IRiftwellAlgebraPool(c.whypeUSDCPool).plugin() != whypePlugin || IRiftwellAlgebraPool(c.kittenWHYPEPool).plugin() != kittenPlugin ||
            whypePlugin.codehash != whypePluginCodeHash || kittenPlugin.codehash != kittenPluginCodeHash)
            revert DependencyChanged();
        if (IRiftwellAlgebraPool(c.whypeUSDCPool).liquidity() == 0 ||
            (token == c.kitten && IRiftwellAlgebraPool(c.kittenWHYPEPool).liquidity() == 0)) revert EmptyLiquidity();
    }

    function _checkRegistry(Configuration memory c) private view {
        IRiftwellAlgebraRouter r = IRiftwellAlgebraRouter(c.router);
        IRiftwellAlgebraFactory f = IRiftwellAlgebraFactory(c.factory);
        if (r.factory() != c.factory || r.WNativeToken() != c.whype || r.poolDeployer() != f.poolDeployer() ||
            f.poolByPair(c.whype, c.usdc) != c.whypeUSDCPool || f.poolByPair(c.kitten, c.whype) != c.kittenWHYPEPool)
            revert DependencyChanged();
        _checkPool(c.whypeUSDCPool, c.factory, c.whype, c.usdc);
        _checkPool(c.kittenWHYPEPool, c.factory, c.kitten, c.whype);
    }
    function _checkPool(address pool, address factory_, address a, address b) private view {
        IRiftwellAlgebraPool p = IRiftwellAlgebraPool(pool);
        address first = a < b ? a : b;
        address second = a < b ? b : a;
        if (p.factory() != factory_ || p.token0() != first || p.token1() != second) revert DependencyChanged();
    }
}
