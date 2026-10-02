// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IRiftwellAlgebraRouter} from "../RiftwellKittenRewardConverter.sol";

/// @dev Original local fixtures only. Unrestricted configuration is intentional.
contract ConverterTestToken is ERC20 {
    uint8 private immutable tokenDecimals;
    bool public falseTransferFrom;
    bool public falseTransfer;
    address public falseTransferSender;
    // 1: false nonzero approve; 2: ignore nonzero approve;
    // 3: false zero approve; 4: ignore zero approve.
    uint8 public approvalMode;
    bool public preserveAllowance;
    bool public taxEnabled;
    address public taxedSender;
    address public callbackSender;
    address public callbackTarget;
    bytes public callbackData;
    bool public callbackSucceeded;
    bytes public callbackReturnData;
    bool private inCallback;

    constructor(string memory symbol_, uint8 decimals_) ERC20(symbol_, symbol_) {
        tokenDecimals = decimals_;
    }
    function decimals() public view override returns (uint8) { return tokenDecimals; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function setFailures(bool transferFrom_, bool transfer_, address sender_, uint8 approvalMode_) external {
        falseTransferFrom = transferFrom_;
        falseTransfer = transfer_;
        falseTransferSender = sender_;
        approvalMode = approvalMode_;
    }
    function setPreserveAllowance(bool enabled) external { preserveAllowance = enabled; }
    function setTax(bool enabled, address sender) external { taxEnabled = enabled; taxedSender = sender; }
    function setCallback(address sender, address target, bytes calldata data) external {
        callbackSender = sender;
        callbackTarget = target;
        callbackData = data;
    }
    function transfer(address to, uint256 amount) public override returns (bool) {
        if (falseTransfer && (falseTransferSender == address(0) || falseTransferSender == msg.sender)) return false;
        return super.transfer(to, amount);
    }
    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (falseTransferFrom) return false;
        return super.transferFrom(from, to, amount);
    }
    function approve(address spender, uint256 amount) public override returns (bool) {
        if ((approvalMode == 1 && amount != 0) || (approvalMode == 3 && amount == 0)) return false;
        if ((approvalMode == 2 && amount != 0) || (approvalMode == 4 && amount == 0)) return true;
        return super.approve(spender, amount);
    }
    function _spendAllowance(address owner, address spender, uint256 amount) internal override {
        if (!preserveAllowance) super._spendAllowance(owner, spender, amount);
    }
    function _update(address from, address to, uint256 amount) internal override {
        if (taxEnabled && from == taxedSender && from != address(0) && to != address(0)) {
            uint256 tax = amount / 100;
            super._update(from, address(0), tax);
            super._update(from, to, amount - tax);
        } else super._update(from, to, amount);
        if (!inCallback && from != address(0) && from == callbackSender && callbackTarget != address(0)) {
            inCallback = true;
            (callbackSucceeded, callbackReturnData) = callbackTarget.call(callbackData);
            inCallback = false;
        }
    }
}

contract ConverterTestPlugin {}

contract ConverterTestPool {
    address public factory;
    address public token0;
    address public token1;
    address public plugin;
    uint128 public liquidity = 1;

    constructor(address factory_, address a, address b, address plugin_) {
        factory = factory_;
        token0 = a < b ? a : b;
        token1 = a < b ? b : a;
        plugin = plugin_;
    }
    function setIdentity(address factory_, address token0_, address token1_) external {
        factory = factory_;
        token0 = token0_;
        token1 = token1_;
    }
    function setPlugin(address value) external { plugin = value; }
    function setLiquidity(uint128 value) external { liquidity = value; }
}

contract ConverterTestFactory {
    address public poolDeployer;
    mapping(address => mapping(address => address)) public poolByPair;
    constructor(address deployer_) { poolDeployer = deployer_; }
    function setPool(address a, address b, address pool) external {
        poolByPair[a][b] = pool;
        poolByPair[b][a] = pool;
    }
    function setPoolDeployer(address value) external { poolDeployer = value; }
}

/// @dev Deliberately does not enforce price floors: tests must prove the converter
/// measures balances and independently rejects an underpaying or lying router.
contract ConverterTestRouter is IRiftwellAlgebraRouter {
    address public override factory;
    address public override poolDeployer;
    address public override WNativeToken;
    uint16 public spendBps = 10_000;
    uint256 public deliveredOutput;
    uint256 public reportedOutput;
    uint256 public calls;
    bool public usedMultihop;
    address public lastTokenIn;
    address public lastTokenOut;
    address public lastDeployer;
    address public lastRecipient;
    uint256 public lastDeadline;
    uint256 public lastAmount;
    uint256 public lastMinimum;
    uint160 public lastLimit;
    bytes public lastPath;
    uint256 public allowanceAtSwap;
    address public callbackTarget;
    bytes public callbackData;
    bool public callbackSucceeded;
    bytes public callbackReturnData;

    constructor(address factory_, address deployer_, address whype_) {
        setRegistry(factory_, deployer_, whype_);
    }
    function setRegistry(address factory_, address deployer_, address whype_) public {
        factory = factory_;
        poolDeployer = deployer_;
        WNativeToken = whype_;
    }
    function setSwap(uint16 spendBps_, uint256 delivered_, uint256 reported_) external {
        spendBps = spendBps_;
        deliveredOutput = delivered_;
        reportedOutput = reported_;
    }
    function setCallback(address target, bytes calldata data) external {
        callbackTarget = target;
        callbackData = data;
    }
    function exactInputSingle(ExactInputSingleParams calldata p) external payable override returns (uint256) {
        usedMultihop = false;
        lastDeployer = p.deployer;
        lastLimit = p.limitSqrtPrice;
        return _swap(p.tokenIn, p.tokenOut, p.recipient, p.deadline, p.amountIn, p.amountOutMinimum);
    }
    function exactInput(ExactInputParams calldata p) external payable override returns (uint256) {
        require(p.path.length == 100, "two-hop path required");
        address input;
        address output;
        bytes calldata route = p.path;
        assembly {
            input := shr(96, calldataload(route.offset))
            output := shr(96, calldataload(add(route.offset, 80)))
        }
        usedMultihop = true;
        lastPath = p.path;
        return _swap(input, output, p.recipient, p.deadline, p.amountIn, p.amountOutMinimum);
    }
    function _swap(address input, address output, address recipient, uint256 deadline, uint256 amount, uint256 minimum) private returns (uint256) {
        calls++;
        lastTokenIn = input;
        lastTokenOut = output;
        lastRecipient = recipient;
        lastDeadline = deadline;
        lastAmount = amount;
        lastMinimum = minimum;
        allowanceAtSwap = IERC20(input).allowance(msg.sender, address(this));
        if (callbackTarget != address(0)) {
            (callbackSucceeded, callbackReturnData) = callbackTarget.call(callbackData);
        }
        require(IERC20(input).transferFrom(msg.sender, address(this), amount * spendBps / 10_000), "input transfer failed");
        require(IERC20(output).transfer(recipient, deliveredOutput), "output transfer failed");
        return reportedOutput;
    }
}
