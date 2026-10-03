// Derived from the unchanged Solidity ABI. Regenerate with npm run bindings.
import type {
  AddressLike,
  BaseContract,
  BigNumberish,
  BytesLike,
  ContractRunner,
  ContractTransactionResponse,
  Overrides,
} from 'ethers';
export type ReadMethod<Args extends readonly unknown[], Output> = ((
  ...args: [...Args, Overrides?]
) => Promise<Output>) & {
  staticCall(...args: [...Args, Overrides?]): Promise<Output>;
};
export type WriteMethod<Args extends readonly unknown[], Output = void> = ((
  ...args: [...Args, Overrides?]
) => Promise<ContractTransactionResponse>) & {
  staticCall(...args: [...Args, Overrides?]): Promise<Output>;
};
export interface IRiftwellAlgebraFactory extends Omit<
  BaseContract,
  'connect' | 'target'
> {
  target: string;
  connect(runner: ContractRunner | null): IRiftwellAlgebraFactory;
  readonly poolByPair: ReadMethod<[AddressLike, AddressLike], string>;
  readonly 'poolByPair(address,address)': ReadMethod<
    [AddressLike, AddressLike],
    string
  >;
  readonly poolDeployer: ReadMethod<[], string>;
  readonly 'poolDeployer()': ReadMethod<[], string>;
}
export interface IRiftwellAlgebraPool extends Omit<
  BaseContract,
  'connect' | 'target'
> {
  target: string;
  connect(runner: ContractRunner | null): IRiftwellAlgebraPool;
  readonly factory: ReadMethod<[], string>;
  readonly 'factory()': ReadMethod<[], string>;
  readonly liquidity: ReadMethod<[], bigint>;
  readonly 'liquidity()': ReadMethod<[], bigint>;
  readonly plugin: ReadMethod<[], string>;
  readonly 'plugin()': ReadMethod<[], string>;
  readonly token0: ReadMethod<[], string>;
  readonly 'token0()': ReadMethod<[], string>;
  readonly token1: ReadMethod<[], string>;
  readonly 'token1()': ReadMethod<[], string>;
}
export interface IRiftwellAlgebraRouter extends Omit<
  BaseContract,
  'connect' | 'target'
> {
  target: string;
  connect(runner: ContractRunner | null): IRiftwellAlgebraRouter;
  readonly exactInput: WriteMethod<
    [
      | readonly [
          BytesLike,
          AddressLike,
          BigNumberish,
          BigNumberish,
          BigNumberish,
        ]
      | {
          path: BytesLike;
          recipient: AddressLike;
          deadline: BigNumberish;
          amountIn: BigNumberish;
          amountOutMinimum: BigNumberish;
        },
    ],
    bigint
  >;
  readonly 'exactInput((bytes,address,uint256,uint256,uint256))': WriteMethod<
    [
      | readonly [
          BytesLike,
          AddressLike,
          BigNumberish,
          BigNumberish,
          BigNumberish,
        ]
      | {
          path: BytesLike;
          recipient: AddressLike;
          deadline: BigNumberish;
          amountIn: BigNumberish;
          amountOutMinimum: BigNumberish;
        },
    ],
    bigint
  >;
  readonly exactInputSingle: WriteMethod<
    [
      | readonly [
          AddressLike,
          AddressLike,
          AddressLike,
          AddressLike,
          BigNumberish,
          BigNumberish,
          BigNumberish,
          BigNumberish,
        ]
      | {
          tokenIn: AddressLike;
          tokenOut: AddressLike;
          deployer: AddressLike;
          recipient: AddressLike;
          deadline: BigNumberish;
          amountIn: BigNumberish;
          amountOutMinimum: BigNumberish;
          limitSqrtPrice: BigNumberish;
        },
    ],
    bigint
  >;
  readonly 'exactInputSingle((address,address,address,address,uint256,uint256,uint256,uint160))': WriteMethod<
    [
      | readonly [
          AddressLike,
          AddressLike,
          AddressLike,
          AddressLike,
          BigNumberish,
          BigNumberish,
          BigNumberish,
          BigNumberish,
        ]
      | {
          tokenIn: AddressLike;
          tokenOut: AddressLike;
          deployer: AddressLike;
          recipient: AddressLike;
          deadline: BigNumberish;
          amountIn: BigNumberish;
          amountOutMinimum: BigNumberish;
          limitSqrtPrice: BigNumberish;
        },
    ],
    bigint
  >;
  readonly factory: ReadMethod<[], string>;
  readonly 'factory()': ReadMethod<[], string>;
  readonly poolDeployer: ReadMethod<[], string>;
  readonly 'poolDeployer()': ReadMethod<[], string>;
  readonly WNativeToken: ReadMethod<[], string>;
  readonly 'WNativeToken()': ReadMethod<[], string>;
}
export interface RiftwellKittenRewardConverter extends Omit<
  BaseContract,
  'connect' | 'target'
> {
  target: string;
  connect(runner: ContractRunner | null): RiftwellKittenRewardConverter;
  readonly configuration: ReadMethod<
    [],
    readonly [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      bigint,
      bigint,
    ] & {
      router: string;
      factory: string;
      whype: string;
      kitten: string;
      usdc: string;
      whypeUSDCPool: string;
      kittenWHYPEPool: string;
      maxWHYPEInput: bigint;
      maxKITTENInput: bigint;
    }
  >;
  readonly 'configuration()': ReadMethod<
    [],
    readonly [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      bigint,
      bigint,
    ] & {
      router: string;
      factory: string;
      whype: string;
      kitten: string;
      usdc: string;
      whypeUSDCPool: string;
      kittenWHYPEPool: string;
      maxWHYPEInput: bigint;
      maxKITTENInput: bigint;
    }
  >;
  readonly convert: WriteMethod<
    [AddressLike, BigNumberish, BigNumberish, BigNumberish],
    bigint
  >;
  readonly 'convert(address,uint256,uint256,uint256)': WriteMethod<
    [AddressLike, BigNumberish, BigNumberish, BigNumberish],
    bigint
  >;
  readonly deploymentChainId: ReadMethod<[], bigint>;
  readonly 'deploymentChainId()': ReadMethod<[], bigint>;
  readonly factoryCodeHash: ReadMethod<[], string>;
  readonly 'factoryCodeHash()': ReadMethod<[], string>;
  readonly kittenPlugin: ReadMethod<[], string>;
  readonly 'kittenPlugin()': ReadMethod<[], string>;
  readonly kittenPluginCodeHash: ReadMethod<[], string>;
  readonly 'kittenPluginCodeHash()': ReadMethod<[], string>;
  readonly kittenPoolCodeHash: ReadMethod<[], string>;
  readonly 'kittenPoolCodeHash()': ReadMethod<[], string>;
  readonly MAX_DEADLINE_WINDOW: ReadMethod<[], bigint>;
  readonly 'MAX_DEADLINE_WINDOW()': ReadMethod<[], bigint>;
  readonly routerCodeHash: ReadMethod<[], string>;
  readonly 'routerCodeHash()': ReadMethod<[], string>;
  readonly whypePlugin: ReadMethod<[], string>;
  readonly 'whypePlugin()': ReadMethod<[], string>;
  readonly whypePluginCodeHash: ReadMethod<[], string>;
  readonly 'whypePluginCodeHash()': ReadMethod<[], string>;
  readonly whypePoolCodeHash: ReadMethod<[], string>;
  readonly 'whypePoolCodeHash()': ReadMethod<[], string>;
}
export interface IRiftwellLoanState extends Omit<
  BaseContract,
  'connect' | 'target'
> {
  target: string;
  connect(runner: ContractRunner | null): IRiftwellLoanState;
  readonly isLoanActive: ReadMethod<[BigNumberish], boolean>;
  readonly 'isLoanActive(uint256)': ReadMethod<[BigNumberish], boolean>;
}
export interface RiftwellLoanVault extends Omit<
  BaseContract,
  'connect' | 'target'
> {
  target: string;
  connect(runner: ContractRunner | null): RiftwellLoanVault;
  readonly borrower: ReadMethod<[], string>;
  readonly 'borrower()': ReadMethod<[], string>;
  readonly claimClosedPeriod: WriteMethod<
    [AddressLike, BigNumberish, AddressLike],
    void
  >;
  readonly 'claimClosedPeriod(address,uint256,address)': WriteMethod<
    [AddressLike, BigNumberish, AddressLike],
    void
  >;
  readonly claimsVerified: ReadMethod<[], boolean>;
  readonly 'claimsVerified()': ReadMethod<[], boolean>;
  readonly collection: ReadMethod<[], string>;
  readonly 'collection()': ReadMethod<[], string>;
  readonly loanId: ReadMethod<[], bigint>;
  readonly 'loanId()': ReadMethod<[], bigint>;
  readonly manager: ReadMethod<[], string>;
  readonly 'manager()': ReadMethod<[], string>;
  readonly onERC721Received: WriteMethod<
    [AddressLike, AddressLike, BigNumberish, BytesLike],
    string
  >;
  readonly 'onERC721Received(address,address,uint256,bytes)': WriteMethod<
    [AddressLike, AddressLike, BigNumberish, BytesLike],
    string
  >;
  readonly operator: ReadMethod<[], string>;
  readonly 'operator()': ReadMethod<[], string>;
  readonly releaseCollateral: WriteMethod<[AddressLike], void>;
  readonly 'releaseCollateral(address)': WriteMethod<[AddressLike], void>;
  readonly setOperator: WriteMethod<[AddressLike], void>;
  readonly 'setOperator(address)': WriteMethod<[AddressLike], void>;
  readonly settlementToken: ReadMethod<[], string>;
  readonly 'settlementToken()': ReadMethod<[], string>;
  readonly takeSettlement: WriteMethod<[BigNumberish], void>;
  readonly 'takeSettlement(uint256)': WriteMethod<[BigNumberish], void>;
  readonly tokenId: ReadMethod<[], bigint>;
  readonly 'tokenId()': ReadMethod<[], bigint>;
  readonly vote: WriteMethod<
    [readonly AddressLike[], readonly BigNumberish[]],
    void
  >;
  readonly 'vote(address[],uint256[])': WriteMethod<
    [readonly AddressLike[], readonly BigNumberish[]],
    void
  >;
  readonly voter: ReadMethod<[], string>;
  readonly 'voter()': ReadMethod<[], string>;
  readonly withdrawSurplus: WriteMethod<[AddressLike, AddressLike], void>;
  readonly 'withdrawSurplus(address,address)': WriteMethod<
    [AddressLike, AddressLike],
    void
  >;
}
export interface RiftwellLoans extends Omit<
  BaseContract,
  'connect' | 'target'
> {
  target: string;
  connect(runner: ContractRunner | null): RiftwellLoans;
  readonly acceptOffer: WriteMethod<[BigNumberish], bigint>;
  readonly 'acceptOffer(uint256)': WriteMethod<[BigNumberish], bigint>;
  readonly activeFinancedListing: ReadMethod<[BigNumberish], bigint>;
  readonly 'activeFinancedListing(uint256)': ReadMethod<[BigNumberish], bigint>;
  readonly activeLoanForToken: ReadMethod<[BigNumberish], bigint>;
  readonly 'activeLoanForToken(uint256)': ReadMethod<[BigNumberish], bigint>;
  readonly borrowerCredits: ReadMethod<[AddressLike], bigint>;
  readonly 'borrowerCredits(address)': ReadMethod<[AddressLike], bigint>;
  readonly BPS: ReadMethod<[], bigint>;
  readonly 'BPS()': ReadMethod<[], bigint>;
  readonly buyFinancedCollateral: WriteMethod<
    [BigNumberish, BigNumberish, AddressLike],
    void
  >;
  readonly 'buyFinancedCollateral(uint256,uint256,address)': WriteMethod<
    [BigNumberish, BigNumberish, AddressLike],
    void
  >;
  readonly cancelFinancedListing: WriteMethod<[BigNumberish], void>;
  readonly 'cancelFinancedListing(uint256)': WriteMethod<[BigNumberish], void>;
  readonly cancelOffer: WriteMethod<[BigNumberish], void>;
  readonly 'cancelOffer(uint256)': WriteMethod<[BigNumberish], void>;
  readonly claimsVerified: ReadMethod<[], boolean>;
  readonly 'claimsVerified()': ReadMethod<[], boolean>;
  readonly collection: ReadMethod<[], string>;
  readonly 'collection()': ReadMethod<[], string>;
  readonly debt: ReadMethod<
    [BigNumberish],
    readonly [bigint, bigint, bigint] & {
      principal: bigint;
      interest: bigint;
      total: bigint;
    }
  >;
  readonly 'debt(uint256)': ReadMethod<
    [BigNumberish],
    readonly [bigint, bigint, bigint] & {
      principal: bigint;
      interest: bigint;
      total: bigint;
    }
  >;
  readonly escrowedOfferCapital: ReadMethod<[], bigint>;
  readonly 'escrowedOfferCapital()': ReadMethod<[], bigint>;
  readonly FEE_BPS: ReadMethod<[], bigint>;
  readonly 'FEE_BPS()': ReadMethod<[], bigint>;
  readonly financedListingCount: ReadMethod<[], bigint>;
  readonly 'financedListingCount()': ReadMethod<[], bigint>;
  readonly financedListings: ReadMethod<
    [BigNumberish],
    readonly [bigint, bigint, bigint, boolean] & {
      loanId: bigint;
      price: bigint;
      expiry: bigint;
      active: boolean;
    }
  >;
  readonly 'financedListings(uint256)': ReadMethod<
    [BigNumberish],
    readonly [bigint, bigint, bigint, boolean] & {
      loanId: bigint;
      price: bigint;
      expiry: bigint;
      active: boolean;
    }
  >;
  readonly forgiveDebt: WriteMethod<[BigNumberish], void>;
  readonly 'forgiveDebt(uint256)': WriteMethod<[BigNumberish], void>;
  readonly fundOffer: WriteMethod<
    [
      AddressLike,
      BigNumberish,
      BigNumberish,
      BigNumberish,
      BigNumberish,
      BigNumberish,
      BigNumberish,
      BigNumberish,
    ],
    bigint
  >;
  readonly 'fundOffer(address,uint256,uint128,uint32,uint32,uint64,uint64,uint128)': WriteMethod<
    [
      AddressLike,
      BigNumberish,
      BigNumberish,
      BigNumberish,
      BigNumberish,
      BigNumberish,
      BigNumberish,
      BigNumberish,
    ],
    bigint
  >;
  readonly guardian: ReadMethod<[], string>;
  readonly 'guardian()': ReadMethod<[], string>;
  readonly isLoanActive: ReadMethod<[BigNumberish], boolean>;
  readonly 'isLoanActive(uint256)': ReadMethod<[BigNumberish], boolean>;
  readonly lenderCredits: ReadMethod<[AddressLike], bigint>;
  readonly 'lenderCredits(address)': ReadMethod<[AddressLike], bigint>;
  readonly listFinancedCollateral: WriteMethod<
    [BigNumberish, BigNumberish, BigNumberish],
    bigint
  >;
  readonly 'listFinancedCollateral(uint256,uint256,uint64)': WriteMethod<
    [BigNumberish, BigNumberish, BigNumberish],
    bigint
  >;
  readonly loanCount: ReadMethod<[], bigint>;
  readonly 'loanCount()': ReadMethod<[], bigint>;
  readonly loans: ReadMethod<
    [BigNumberish],
    readonly [
      string,
      string,
      string,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      boolean,
    ] & {
      lender: string;
      borrower: string;
      vault: string;
      tokenId: bigint;
      principal: bigint;
      aprBps: bigint;
      maturity: bigint;
      lastAccrued: bigint;
      accruedInterest: bigint;
      interestRemainder: bigint;
      active: boolean;
    }
  >;
  readonly 'loans(uint256)': ReadMethod<
    [BigNumberish],
    readonly [
      string,
      string,
      string,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      boolean,
    ] & {
      lender: string;
      borrower: string;
      vault: string;
      tokenId: bigint;
      principal: bigint;
      aprBps: bigint;
      maturity: bigint;
      lastAccrued: bigint;
      accruedInterest: bigint;
      interestRemainder: bigint;
      active: boolean;
    }
  >;
  readonly MAX_APR_BPS: ReadMethod<[], bigint>;
  readonly 'MAX_APR_BPS()': ReadMethod<[], bigint>;
  readonly newLoansPaused: ReadMethod<[], boolean>;
  readonly 'newLoansPaused()': ReadMethod<[], boolean>;
  readonly offerCount: ReadMethod<[], bigint>;
  readonly 'offerCount()': ReadMethod<[], bigint>;
  readonly offers: ReadMethod<
    [BigNumberish],
    readonly [
      string,
      string,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      boolean,
    ] & {
      lender: string;
      borrower: string;
      tokenId: bigint;
      principal: bigint;
      aprBps: bigint;
      duration: bigint;
      expiry: bigint;
      minimumLockEnd: bigint;
      minimumLockedAmount: bigint;
      active: boolean;
    }
  >;
  readonly 'offers(uint256)': ReadMethod<
    [BigNumberish],
    readonly [
      string,
      string,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      boolean,
    ] & {
      lender: string;
      borrower: string;
      tokenId: bigint;
      principal: bigint;
      aprBps: bigint;
      duration: bigint;
      expiry: bigint;
      minimumLockEnd: bigint;
      minimumLockedAmount: bigint;
      active: boolean;
    }
  >;
  readonly repay: WriteMethod<[BigNumberish, BigNumberish], bigint>;
  readonly 'repay(uint256,uint256)': WriteMethod<
    [BigNumberish, BigNumberish],
    bigint
  >;
  readonly repayFromRewards: WriteMethod<[BigNumberish], bigint>;
  readonly 'repayFromRewards(uint256)': WriteMethod<[BigNumberish], bigint>;
  readonly setNewLoansPaused: WriteMethod<[boolean], void>;
  readonly 'setNewLoansPaused(bool)': WriteMethod<[boolean], void>;
  readonly settlementToken: ReadMethod<[], string>;
  readonly 'settlementToken()': ReadMethod<[], string>;
  readonly totalBorrowerCredits: ReadMethod<[], bigint>;
  readonly 'totalBorrowerCredits()': ReadMethod<[], bigint>;
  readonly totalLenderCredits: ReadMethod<[], bigint>;
  readonly 'totalLenderCredits()': ReadMethod<[], bigint>;
  readonly treasury: ReadMethod<[], string>;
  readonly 'treasury()': ReadMethod<[], string>;
  readonly voter: ReadMethod<[], string>;
  readonly 'voter()': ReadMethod<[], string>;
  readonly withdrawBorrowerCredit: WriteMethod<
    [AddressLike, BigNumberish],
    void
  >;
  readonly 'withdrawBorrowerCredit(address,uint256)': WriteMethod<
    [AddressLike, BigNumberish],
    void
  >;
  readonly withdrawCollateral: WriteMethod<[BigNumberish, AddressLike], void>;
  readonly 'withdrawCollateral(uint256,address)': WriteMethod<
    [BigNumberish, AddressLike],
    void
  >;
  readonly withdrawLenderCredit: WriteMethod<[AddressLike, BigNumberish], void>;
  readonly 'withdrawLenderCredit(address,uint256)': WriteMethod<
    [AddressLike, BigNumberish],
    void
  >;
  readonly YEAR: ReadMethod<[], bigint>;
  readonly 'YEAR()': ReadMethod<[], bigint>;
}
export interface RiftwellMarket extends Omit<
  BaseContract,
  'connect' | 'target'
> {
  target: string;
  connect(runner: ContractRunner | null): RiftwellMarket;
  readonly BPS: ReadMethod<[], bigint>;
  readonly 'BPS()': ReadMethod<[], bigint>;
  readonly buy: WriteMethod<[BigNumberish, BigNumberish, AddressLike], void>;
  readonly 'buy(uint256,uint256,address)': WriteMethod<
    [BigNumberish, BigNumberish, AddressLike],
    void
  >;
  readonly cancelListing: WriteMethod<[BigNumberish], void>;
  readonly 'cancelListing(uint256)': WriteMethod<[BigNumberish], void>;
  readonly collection: ReadMethod<[], string>;
  readonly 'collection()': ReadMethod<[], string>;
  readonly createListing: WriteMethod<
    [BigNumberish, BigNumberish, BigNumberish],
    bigint
  >;
  readonly 'createListing(uint256,uint256,uint256)': WriteMethod<
    [BigNumberish, BigNumberish, BigNumberish],
    bigint
  >;
  readonly currentListing: ReadMethod<[BigNumberish], bigint>;
  readonly 'currentListing(uint256)': ReadMethod<[BigNumberish], bigint>;
  readonly FEE_BPS: ReadMethod<[], bigint>;
  readonly 'FEE_BPS()': ReadMethod<[], bigint>;
  readonly invalidateListings: WriteMethod<[], void>;
  readonly 'invalidateListings()': WriteMethod<[], void>;
  readonly listingCount: ReadMethod<[], bigint>;
  readonly 'listingCount()': ReadMethod<[], bigint>;
  readonly listings: ReadMethod<
    [BigNumberish],
    readonly [string, bigint, bigint, bigint, bigint, boolean] & {
      seller: string;
      tokenId: bigint;
      price: bigint;
      expiry: bigint;
      sellerNonce: bigint;
      active: boolean;
    }
  >;
  readonly 'listings(uint256)': ReadMethod<
    [BigNumberish],
    readonly [string, bigint, bigint, bigint, bigint, boolean] & {
      seller: string;
      tokenId: bigint;
      price: bigint;
      expiry: bigint;
      sellerNonce: bigint;
      active: boolean;
    }
  >;
  readonly paymentToken: ReadMethod<[], string>;
  readonly 'paymentToken()': ReadMethod<[], string>;
  readonly sellerNonces: ReadMethod<[AddressLike], bigint>;
  readonly 'sellerNonces(address)': ReadMethod<[AddressLike], bigint>;
  readonly treasury: ReadMethod<[], string>;
  readonly 'treasury()': ReadMethod<[], string>;
}
export interface IKittenVoter extends Omit<BaseContract, 'connect' | 'target'> {
  target: string;
  connect(runner: ContractRunner | null): IKittenVoter;
  readonly checkPeriodVoted: ReadMethod<[BigNumberish, BigNumberish], boolean>;
  readonly 'checkPeriodVoted(uint256,uint256)': ReadMethod<
    [BigNumberish, BigNumberish],
    boolean
  >;
  readonly claimVotingRewardBatch: WriteMethod<
    [readonly AddressLike[], BigNumberish],
    void
  >;
  readonly 'claimVotingRewardBatch(address[],uint256)': WriteMethod<
    [readonly AddressLike[], BigNumberish],
    void
  >;
  readonly getCurrentPeriod: ReadMethod<[], bigint>;
  readonly 'getCurrentPeriod()': ReadMethod<[], bigint>;
  readonly getGauge: ReadMethod<
    [AddressLike],
    readonly [string, boolean, string, boolean, string] & {
      gauge: string;
      isAlgebra: boolean;
      votingReward: string;
      isAlive: boolean;
      vault: string;
    }
  >;
  readonly 'getGauge(address)': ReadMethod<
    [AddressLike],
    readonly [string, boolean, string, boolean, string] & {
      gauge: string;
      isAlgebra: boolean;
      votingReward: string;
      isAlive: boolean;
      vault: string;
    }
  >;
  readonly getTokenIdVotes: ReadMethod<
    [BigNumberish, BigNumberish],
    readonly [readonly string[], readonly bigint[]] & {
      pools: readonly string[];
      weights: readonly bigint[];
    }
  >;
  readonly 'getTokenIdVotes(uint256,uint256)': ReadMethod<
    [BigNumberish, BigNumberish],
    readonly [readonly string[], readonly bigint[]] & {
      pools: readonly string[];
      weights: readonly bigint[];
    }
  >;
  readonly veKitten: ReadMethod<[], string>;
  readonly 'veKitten()': ReadMethod<[], string>;
  readonly vote: WriteMethod<
    [BigNumberish, readonly AddressLike[], readonly BigNumberish[]],
    void
  >;
  readonly 'vote(uint256,address[],uint256[])': WriteMethod<
    [BigNumberish, readonly AddressLike[], readonly BigNumberish[]],
    void
  >;
}
export interface IKittenVotingEscrow extends Omit<
  BaseContract,
  'connect' | 'target'
> {
  target: string;
  connect(runner: ContractRunner | null): IKittenVotingEscrow;
  readonly balanceOfNFT: ReadMethod<[BigNumberish], bigint>;
  readonly 'balanceOfNFT(uint256)': ReadMethod<[BigNumberish], bigint>;
  readonly getApproved: ReadMethod<[BigNumberish], string>;
  readonly 'getApproved(uint256)': ReadMethod<[BigNumberish], string>;
  readonly isApprovedForAll: ReadMethod<[AddressLike, AddressLike], boolean>;
  readonly 'isApprovedForAll(address,address)': ReadMethod<
    [AddressLike, AddressLike],
    boolean
  >;
  readonly isApprovedOrOwner: ReadMethod<[AddressLike, BigNumberish], boolean>;
  readonly 'isApprovedOrOwner(address,uint256)': ReadMethod<
    [AddressLike, BigNumberish],
    boolean
  >;
  readonly kitten: ReadMethod<[], string>;
  readonly 'kitten()': ReadMethod<[], string>;
  readonly locked: ReadMethod<
    [BigNumberish],
    readonly [bigint, bigint] & { amount: bigint; end: bigint }
  >;
  readonly 'locked(uint256)': ReadMethod<
    [BigNumberish],
    readonly [bigint, bigint] & { amount: bigint; end: bigint }
  >;
  readonly MAXTIME: ReadMethod<[], bigint>;
  readonly 'MAXTIME()': ReadMethod<[], bigint>;
  readonly ownerOf: ReadMethod<[BigNumberish], string>;
  readonly 'ownerOf(uint256)': ReadMethod<[BigNumberish], string>;
  readonly ownership_change: ReadMethod<[BigNumberish], bigint>;
  readonly 'ownership_change(uint256)': ReadMethod<[BigNumberish], bigint>;
  readonly safeTransferFrom: WriteMethod<
    [AddressLike, AddressLike, BigNumberish],
    void
  >;
  readonly 'safeTransferFrom(address,address,uint256)': WriteMethod<
    [AddressLike, AddressLike, BigNumberish],
    void
  >;
  readonly transferFrom: WriteMethod<
    [AddressLike, AddressLike, BigNumberish],
    void
  >;
  readonly 'transferFrom(address,address,uint256)': WriteMethod<
    [AddressLike, AddressLike, BigNumberish],
    void
  >;
  readonly voted: ReadMethod<[BigNumberish], boolean>;
  readonly 'voted(uint256)': ReadMethod<[BigNumberish], boolean>;
  readonly voter: ReadMethod<[], string>;
  readonly 'voter()': ReadMethod<[], string>;
}
export interface IKittenVotingReward extends Omit<
  BaseContract,
  'connect' | 'target'
> {
  target: string;
  connect(runner: ContractRunner | null): IKittenVotingReward;
  readonly earnedForPeriod: ReadMethod<
    [BigNumberish, BigNumberish, AddressLike],
    bigint
  >;
  readonly 'earnedForPeriod(uint256,uint256,address)': ReadMethod<
    [BigNumberish, BigNumberish, AddressLike],
    bigint
  >;
  readonly earnedForToken: ReadMethod<[BigNumberish, AddressLike], bigint>;
  readonly 'earnedForToken(uint256,address)': ReadMethod<
    [BigNumberish, AddressLike],
    bigint
  >;
  readonly earnedForTokenId: ReadMethod<
    [BigNumberish],
    readonly [readonly bigint[], readonly string[]] & {
      amounts: readonly bigint[];
      tokens: readonly string[];
    }
  >;
  readonly 'earnedForTokenId(uint256)': ReadMethod<
    [BigNumberish],
    readonly [readonly bigint[], readonly string[]] & {
      amounts: readonly bigint[];
      tokens: readonly string[];
    }
  >;
  readonly getRewardForOwner: WriteMethod<[BigNumberish], void>;
  readonly 'getRewardForOwner(uint256)': WriteMethod<[BigNumberish], void>;
  readonly getRewardForPeriod: WriteMethod<
    [BigNumberish, BigNumberish, AddressLike],
    void
  >;
  readonly 'getRewardForPeriod(uint256,uint256,address)': WriteMethod<
    [BigNumberish, BigNumberish, AddressLike],
    void
  >;
  readonly getRewardForTokenId: WriteMethod<[BigNumberish], void>;
  readonly 'getRewardForTokenId(uint256)': WriteMethod<[BigNumberish], void>;
  readonly getRewardList: ReadMethod<[], readonly string[]>;
  readonly 'getRewardList()': ReadMethod<[], readonly string[]>;
  readonly veKitten: ReadMethod<[], string>;
  readonly 'veKitten()': ReadMethod<[], string>;
  readonly voter: ReadMethod<[], string>;
  readonly 'voter()': ReadMethod<[], string>;
}
export interface ConverterTestFactory extends Omit<
  BaseContract,
  'connect' | 'target'
> {
  target: string;
  connect(runner: ContractRunner | null): ConverterTestFactory;
  readonly poolByPair: ReadMethod<[AddressLike, AddressLike], string>;
  readonly 'poolByPair(address,address)': ReadMethod<
    [AddressLike, AddressLike],
    string
  >;
  readonly poolDeployer: ReadMethod<[], string>;
  readonly 'poolDeployer()': ReadMethod<[], string>;
  readonly setPool: WriteMethod<[AddressLike, AddressLike, AddressLike], void>;
  readonly 'setPool(address,address,address)': WriteMethod<
    [AddressLike, AddressLike, AddressLike],
    void
  >;
  readonly setPoolDeployer: WriteMethod<[AddressLike], void>;
  readonly 'setPoolDeployer(address)': WriteMethod<[AddressLike], void>;
}
export interface ConverterTestPlugin extends Omit<
  BaseContract,
  'connect' | 'target'
> {
  target: string;
  connect(runner: ContractRunner | null): ConverterTestPlugin;
}
export interface ConverterTestPool extends Omit<
  BaseContract,
  'connect' | 'target'
> {
  target: string;
  connect(runner: ContractRunner | null): ConverterTestPool;
  readonly factory: ReadMethod<[], string>;
  readonly 'factory()': ReadMethod<[], string>;
  readonly liquidity: ReadMethod<[], bigint>;
  readonly 'liquidity()': ReadMethod<[], bigint>;
  readonly plugin: ReadMethod<[], string>;
  readonly 'plugin()': ReadMethod<[], string>;
  readonly setIdentity: WriteMethod<
    [AddressLike, AddressLike, AddressLike],
    void
  >;
  readonly 'setIdentity(address,address,address)': WriteMethod<
    [AddressLike, AddressLike, AddressLike],
    void
  >;
  readonly setLiquidity: WriteMethod<[BigNumberish], void>;
  readonly 'setLiquidity(uint128)': WriteMethod<[BigNumberish], void>;
  readonly setPlugin: WriteMethod<[AddressLike], void>;
  readonly 'setPlugin(address)': WriteMethod<[AddressLike], void>;
  readonly token0: ReadMethod<[], string>;
  readonly 'token0()': ReadMethod<[], string>;
  readonly token1: ReadMethod<[], string>;
  readonly 'token1()': ReadMethod<[], string>;
}
export interface ConverterTestRouter extends Omit<
  BaseContract,
  'connect' | 'target'
> {
  target: string;
  connect(runner: ContractRunner | null): ConverterTestRouter;
  readonly allowanceAtSwap: ReadMethod<[], bigint>;
  readonly 'allowanceAtSwap()': ReadMethod<[], bigint>;
  readonly callbackData: ReadMethod<[], string>;
  readonly 'callbackData()': ReadMethod<[], string>;
  readonly callbackReturnData: ReadMethod<[], string>;
  readonly 'callbackReturnData()': ReadMethod<[], string>;
  readonly callbackSucceeded: ReadMethod<[], boolean>;
  readonly 'callbackSucceeded()': ReadMethod<[], boolean>;
  readonly callbackTarget: ReadMethod<[], string>;
  readonly 'callbackTarget()': ReadMethod<[], string>;
  readonly calls: ReadMethod<[], bigint>;
  readonly 'calls()': ReadMethod<[], bigint>;
  readonly deliveredOutput: ReadMethod<[], bigint>;
  readonly 'deliveredOutput()': ReadMethod<[], bigint>;
  readonly exactInput: WriteMethod<
    [
      | readonly [
          BytesLike,
          AddressLike,
          BigNumberish,
          BigNumberish,
          BigNumberish,
        ]
      | {
          path: BytesLike;
          recipient: AddressLike;
          deadline: BigNumberish;
          amountIn: BigNumberish;
          amountOutMinimum: BigNumberish;
        },
    ],
    bigint
  >;
  readonly 'exactInput((bytes,address,uint256,uint256,uint256))': WriteMethod<
    [
      | readonly [
          BytesLike,
          AddressLike,
          BigNumberish,
          BigNumberish,
          BigNumberish,
        ]
      | {
          path: BytesLike;
          recipient: AddressLike;
          deadline: BigNumberish;
          amountIn: BigNumberish;
          amountOutMinimum: BigNumberish;
        },
    ],
    bigint
  >;
  readonly exactInputSingle: WriteMethod<
    [
      | readonly [
          AddressLike,
          AddressLike,
          AddressLike,
          AddressLike,
          BigNumberish,
          BigNumberish,
          BigNumberish,
          BigNumberish,
        ]
      | {
          tokenIn: AddressLike;
          tokenOut: AddressLike;
          deployer: AddressLike;
          recipient: AddressLike;
          deadline: BigNumberish;
          amountIn: BigNumberish;
          amountOutMinimum: BigNumberish;
          limitSqrtPrice: BigNumberish;
        },
    ],
    bigint
  >;
  readonly 'exactInputSingle((address,address,address,address,uint256,uint256,uint256,uint160))': WriteMethod<
    [
      | readonly [
          AddressLike,
          AddressLike,
          AddressLike,
          AddressLike,
          BigNumberish,
          BigNumberish,
          BigNumberish,
          BigNumberish,
        ]
      | {
          tokenIn: AddressLike;
          tokenOut: AddressLike;
          deployer: AddressLike;
          recipient: AddressLike;
          deadline: BigNumberish;
          amountIn: BigNumberish;
          amountOutMinimum: BigNumberish;
          limitSqrtPrice: BigNumberish;
        },
    ],
    bigint
  >;
  readonly factory: ReadMethod<[], string>;
  readonly 'factory()': ReadMethod<[], string>;
  readonly lastAmount: ReadMethod<[], bigint>;
  readonly 'lastAmount()': ReadMethod<[], bigint>;
  readonly lastDeadline: ReadMethod<[], bigint>;
  readonly 'lastDeadline()': ReadMethod<[], bigint>;
  readonly lastDeployer: ReadMethod<[], string>;
  readonly 'lastDeployer()': ReadMethod<[], string>;
  readonly lastLimit: ReadMethod<[], bigint>;
  readonly 'lastLimit()': ReadMethod<[], bigint>;
  readonly lastMinimum: ReadMethod<[], bigint>;
  readonly 'lastMinimum()': ReadMethod<[], bigint>;
  readonly lastPath: ReadMethod<[], string>;
  readonly 'lastPath()': ReadMethod<[], string>;
  readonly lastRecipient: ReadMethod<[], string>;
  readonly 'lastRecipient()': ReadMethod<[], string>;
  readonly lastTokenIn: ReadMethod<[], string>;
  readonly 'lastTokenIn()': ReadMethod<[], string>;
  readonly lastTokenOut: ReadMethod<[], string>;
  readonly 'lastTokenOut()': ReadMethod<[], string>;
  readonly poolDeployer: ReadMethod<[], string>;
  readonly 'poolDeployer()': ReadMethod<[], string>;
  readonly reportedOutput: ReadMethod<[], bigint>;
  readonly 'reportedOutput()': ReadMethod<[], bigint>;
  readonly setCallback: WriteMethod<[AddressLike, BytesLike], void>;
  readonly 'setCallback(address,bytes)': WriteMethod<
    [AddressLike, BytesLike],
    void
  >;
  readonly setRegistry: WriteMethod<
    [AddressLike, AddressLike, AddressLike],
    void
  >;
  readonly 'setRegistry(address,address,address)': WriteMethod<
    [AddressLike, AddressLike, AddressLike],
    void
  >;
  readonly setSwap: WriteMethod<
    [BigNumberish, BigNumberish, BigNumberish],
    void
  >;
  readonly 'setSwap(uint16,uint256,uint256)': WriteMethod<
    [BigNumberish, BigNumberish, BigNumberish],
    void
  >;
  readonly spendBps: ReadMethod<[], bigint>;
  readonly 'spendBps()': ReadMethod<[], bigint>;
  readonly usedMultihop: ReadMethod<[], boolean>;
  readonly 'usedMultihop()': ReadMethod<[], boolean>;
  readonly WNativeToken: ReadMethod<[], string>;
  readonly 'WNativeToken()': ReadMethod<[], string>;
}
export interface ConverterTestToken extends Omit<
  BaseContract,
  'connect' | 'target'
> {
  target: string;
  connect(runner: ContractRunner | null): ConverterTestToken;
  readonly allowance: ReadMethod<[AddressLike, AddressLike], bigint>;
  readonly 'allowance(address,address)': ReadMethod<
    [AddressLike, AddressLike],
    bigint
  >;
  readonly approvalMode: ReadMethod<[], bigint>;
  readonly 'approvalMode()': ReadMethod<[], bigint>;
  readonly approve: WriteMethod<[AddressLike, BigNumberish], boolean>;
  readonly 'approve(address,uint256)': WriteMethod<
    [AddressLike, BigNumberish],
    boolean
  >;
  readonly balanceOf: ReadMethod<[AddressLike], bigint>;
  readonly 'balanceOf(address)': ReadMethod<[AddressLike], bigint>;
  readonly callbackData: ReadMethod<[], string>;
  readonly 'callbackData()': ReadMethod<[], string>;
  readonly callbackReturnData: ReadMethod<[], string>;
  readonly 'callbackReturnData()': ReadMethod<[], string>;
  readonly callbackSender: ReadMethod<[], string>;
  readonly 'callbackSender()': ReadMethod<[], string>;
  readonly callbackSucceeded: ReadMethod<[], boolean>;
  readonly 'callbackSucceeded()': ReadMethod<[], boolean>;
  readonly callbackTarget: ReadMethod<[], string>;
  readonly 'callbackTarget()': ReadMethod<[], string>;
  readonly decimals: ReadMethod<[], bigint>;
  readonly 'decimals()': ReadMethod<[], bigint>;
  readonly falseTransfer: ReadMethod<[], boolean>;
  readonly 'falseTransfer()': ReadMethod<[], boolean>;
  readonly falseTransferFrom: ReadMethod<[], boolean>;
  readonly 'falseTransferFrom()': ReadMethod<[], boolean>;
  readonly falseTransferSender: ReadMethod<[], string>;
  readonly 'falseTransferSender()': ReadMethod<[], string>;
  readonly mint: WriteMethod<[AddressLike, BigNumberish], void>;
  readonly 'mint(address,uint256)': WriteMethod<
    [AddressLike, BigNumberish],
    void
  >;
  readonly name: ReadMethod<[], string>;
  readonly 'name()': ReadMethod<[], string>;
  readonly preserveAllowance: ReadMethod<[], boolean>;
  readonly 'preserveAllowance()': ReadMethod<[], boolean>;
  readonly setCallback: WriteMethod<
    [AddressLike, AddressLike, BytesLike],
    void
  >;
  readonly 'setCallback(address,address,bytes)': WriteMethod<
    [AddressLike, AddressLike, BytesLike],
    void
  >;
  readonly setFailures: WriteMethod<
    [boolean, boolean, AddressLike, BigNumberish],
    void
  >;
  readonly 'setFailures(bool,bool,address,uint8)': WriteMethod<
    [boolean, boolean, AddressLike, BigNumberish],
    void
  >;
  readonly setPreserveAllowance: WriteMethod<[boolean], void>;
  readonly 'setPreserveAllowance(bool)': WriteMethod<[boolean], void>;
  readonly setTax: WriteMethod<[boolean, AddressLike], void>;
  readonly 'setTax(bool,address)': WriteMethod<[boolean, AddressLike], void>;
  readonly symbol: ReadMethod<[], string>;
  readonly 'symbol()': ReadMethod<[], string>;
  readonly taxedSender: ReadMethod<[], string>;
  readonly 'taxedSender()': ReadMethod<[], string>;
  readonly taxEnabled: ReadMethod<[], boolean>;
  readonly 'taxEnabled()': ReadMethod<[], boolean>;
  readonly totalSupply: ReadMethod<[], bigint>;
  readonly 'totalSupply()': ReadMethod<[], bigint>;
  readonly transfer: WriteMethod<[AddressLike, BigNumberish], boolean>;
  readonly 'transfer(address,uint256)': WriteMethod<
    [AddressLike, BigNumberish],
    boolean
  >;
  readonly transferFrom: WriteMethod<
    [AddressLike, AddressLike, BigNumberish],
    boolean
  >;
  readonly 'transferFrom(address,address,uint256)': WriteMethod<
    [AddressLike, AddressLike, BigNumberish],
    boolean
  >;
}
export interface FinancedSaleReenteringReceiver extends Omit<
  BaseContract,
  'connect' | 'target'
> {
  target: string;
  connect(runner: ContractRunner | null): FinancedSaleReenteringReceiver;
  readonly loans: ReadMethod<[], string>;
  readonly 'loans()': ReadMethod<[], string>;
  readonly onERC721Received: WriteMethod<
    [AddressLike, AddressLike, BigNumberish, BytesLike],
    string
  >;
  readonly 'onERC721Received(address,address,uint256,bytes)': WriteMethod<
    [AddressLike, AddressLike, BigNumberish, BytesLike],
    string
  >;
  readonly reentryReturnData: ReadMethod<[], string>;
  readonly 'reentryReturnData()': ReadMethod<[], string>;
  readonly reentrySucceeded: ReadMethod<[], boolean>;
  readonly 'reentrySucceeded()': ReadMethod<[], boolean>;
  readonly setTarget: WriteMethod<[BigNumberish], void>;
  readonly 'setTarget(uint256)': WriteMethod<[BigNumberish], void>;
  readonly targetListing: ReadMethod<[], bigint>;
  readonly 'targetListing()': ReadMethod<[], bigint>;
}
export interface LoanBlacklistUSDC extends Omit<
  BaseContract,
  'connect' | 'target'
> {
  target: string;
  connect(runner: ContractRunner | null): LoanBlacklistUSDC;
  readonly allowance: ReadMethod<[AddressLike, AddressLike], bigint>;
  readonly 'allowance(address,address)': ReadMethod<
    [AddressLike, AddressLike],
    bigint
  >;
  readonly approve: WriteMethod<[AddressLike, BigNumberish], boolean>;
  readonly 'approve(address,uint256)': WriteMethod<
    [AddressLike, BigNumberish],
    boolean
  >;
  readonly balanceOf: ReadMethod<[AddressLike], bigint>;
  readonly 'balanceOf(address)': ReadMethod<[AddressLike], bigint>;
  readonly blacklisted: ReadMethod<[AddressLike], boolean>;
  readonly 'blacklisted(address)': ReadMethod<[AddressLike], boolean>;
  readonly decimals: ReadMethod<[], bigint>;
  readonly 'decimals()': ReadMethod<[], bigint>;
  readonly mint: WriteMethod<[AddressLike, BigNumberish], void>;
  readonly 'mint(address,uint256)': WriteMethod<
    [AddressLike, BigNumberish],
    void
  >;
  readonly name: ReadMethod<[], string>;
  readonly 'name()': ReadMethod<[], string>;
  readonly setBlacklisted: WriteMethod<[AddressLike, boolean], void>;
  readonly 'setBlacklisted(address,bool)': WriteMethod<
    [AddressLike, boolean],
    void
  >;
  readonly symbol: ReadMethod<[], string>;
  readonly 'symbol()': ReadMethod<[], string>;
  readonly totalSupply: ReadMethod<[], bigint>;
  readonly 'totalSupply()': ReadMethod<[], bigint>;
  readonly transfer: WriteMethod<[AddressLike, BigNumberish], boolean>;
  readonly 'transfer(address,uint256)': WriteMethod<
    [AddressLike, BigNumberish],
    boolean
  >;
  readonly transferFrom: WriteMethod<
    [AddressLike, AddressLike, BigNumberish],
    boolean
  >;
  readonly 'transferFrom(address,address,uint256)': WriteMethod<
    [AddressLike, AddressLike, BigNumberish],
    boolean
  >;
}
export interface LoanTestNFT extends Omit<BaseContract, 'connect' | 'target'> {
  target: string;
  connect(runner: ContractRunner | null): LoanTestNFT;
  readonly approve: WriteMethod<[AddressLike, BigNumberish], void>;
  readonly 'approve(address,uint256)': WriteMethod<
    [AddressLike, BigNumberish],
    void
  >;
  readonly balanceOf: ReadMethod<[AddressLike], bigint>;
  readonly 'balanceOf(address)': ReadMethod<[AddressLike], bigint>;
  readonly balanceOfNFT: ReadMethod<[BigNumberish], bigint>;
  readonly 'balanceOfNFT(uint256)': ReadMethod<[BigNumberish], bigint>;
  readonly getApproved: ReadMethod<[BigNumberish], string>;
  readonly 'getApproved(uint256)': ReadMethod<[BigNumberish], string>;
  readonly isApprovedForAll: ReadMethod<[AddressLike, AddressLike], boolean>;
  readonly 'isApprovedForAll(address,address)': ReadMethod<
    [AddressLike, AddressLike],
    boolean
  >;
  readonly locked: ReadMethod<
    [BigNumberish],
    readonly [bigint, bigint] & { amount: bigint; end: bigint }
  >;
  readonly 'locked(uint256)': ReadMethod<
    [BigNumberish],
    readonly [bigint, bigint] & { amount: bigint; end: bigint }
  >;
  readonly mint: WriteMethod<[AddressLike, BigNumberish], void>;
  readonly 'mint(address,uint256)': WriteMethod<
    [AddressLike, BigNumberish],
    void
  >;
  readonly name: ReadMethod<[], string>;
  readonly 'name()': ReadMethod<[], string>;
  readonly ownerOf: ReadMethod<[BigNumberish], string>;
  readonly 'ownerOf(uint256)': ReadMethod<[BigNumberish], string>;
  readonly safeTransferFrom: WriteMethod<
    [AddressLike, AddressLike, BigNumberish, BytesLike],
    void
  > &
    WriteMethod<[AddressLike, AddressLike, BigNumberish], void>;
  readonly 'safeTransferFrom(address,address,uint256,bytes)': WriteMethod<
    [AddressLike, AddressLike, BigNumberish, BytesLike],
    void
  >;
  readonly 'safeTransferFrom(address,address,uint256)': WriteMethod<
    [AddressLike, AddressLike, BigNumberish],
    void
  >;
  readonly setApprovalForAll: WriteMethod<[AddressLike, boolean], void>;
  readonly 'setApprovalForAll(address,bool)': WriteMethod<
    [AddressLike, boolean],
    void
  >;
  readonly setLock: WriteMethod<
    [BigNumberish, BigNumberish, BigNumberish],
    void
  >;
  readonly 'setLock(uint256,int128,uint256)': WriteMethod<
    [BigNumberish, BigNumberish, BigNumberish],
    void
  >;
  readonly setTransferBlocked: WriteMethod<[BigNumberish, boolean], void>;
  readonly 'setTransferBlocked(uint256,bool)': WriteMethod<
    [BigNumberish, boolean],
    void
  >;
  readonly setVoted: WriteMethod<[BigNumberish, boolean], void>;
  readonly 'setVoted(uint256,bool)': WriteMethod<[BigNumberish, boolean], void>;
  readonly supportsInterface: ReadMethod<[BytesLike], boolean>;
  readonly 'supportsInterface(bytes4)': ReadMethod<[BytesLike], boolean>;
  readonly symbol: ReadMethod<[], string>;
  readonly 'symbol()': ReadMethod<[], string>;
  readonly tokenURI: ReadMethod<[BigNumberish], string>;
  readonly 'tokenURI(uint256)': ReadMethod<[BigNumberish], string>;
  readonly transferBlocked: ReadMethod<[BigNumberish], boolean>;
  readonly 'transferBlocked(uint256)': ReadMethod<[BigNumberish], boolean>;
  readonly transferFrom: WriteMethod<
    [AddressLike, AddressLike, BigNumberish],
    void
  >;
  readonly 'transferFrom(address,address,uint256)': WriteMethod<
    [AddressLike, AddressLike, BigNumberish],
    void
  >;
  readonly voted: ReadMethod<[BigNumberish], boolean>;
  readonly 'voted(uint256)': ReadMethod<[BigNumberish], boolean>;
}
export interface LoanTestReward extends Omit<
  BaseContract,
  'connect' | 'target'
> {
  target: string;
  connect(runner: ContractRunner | null): LoanTestReward;
  readonly getRewardForPeriod: WriteMethod<
    [BigNumberish, BigNumberish, AddressLike],
    void
  >;
  readonly 'getRewardForPeriod(uint256,uint256,address)': WriteMethod<
    [BigNumberish, BigNumberish, AddressLike],
    void
  >;
  readonly payableReward: ReadMethod<[BytesLike], bigint>;
  readonly 'payableReward(bytes32)': ReadMethod<[BytesLike], bigint>;
  readonly setReward: WriteMethod<
    [BigNumberish, BigNumberish, AddressLike, BigNumberish],
    void
  >;
  readonly 'setReward(uint256,uint256,address,uint256)': WriteMethod<
    [BigNumberish, BigNumberish, AddressLike, BigNumberish],
    void
  >;
  readonly veKitten: ReadMethod<[], string>;
  readonly 'veKitten()': ReadMethod<[], string>;
  readonly voter: ReadMethod<[], string>;
  readonly 'voter()': ReadMethod<[], string>;
}
export interface LoanTestVoter extends Omit<
  BaseContract,
  'connect' | 'target'
> {
  target: string;
  connect(runner: ContractRunner | null): LoanTestVoter;
  readonly getCurrentPeriod: ReadMethod<[], bigint>;
  readonly 'getCurrentPeriod()': ReadMethod<[], bigint>;
  readonly getGauge: ReadMethod<
    [AddressLike],
    readonly [string, boolean, string, boolean, string] & {
      gauge: string;
      isAlgebra: boolean;
      votingReward: string;
      isAlive: boolean;
      vault: string;
    }
  >;
  readonly 'getGauge(address)': ReadMethod<
    [AddressLike],
    readonly [string, boolean, string, boolean, string] & {
      gauge: string;
      isAlgebra: boolean;
      votingReward: string;
      isAlive: boolean;
      vault: string;
    }
  >;
  readonly setGauge: WriteMethod<[AddressLike, AddressLike], void>;
  readonly 'setGauge(address,address)': WriteMethod<
    [AddressLike, AddressLike],
    void
  >;
  readonly setPeriod: WriteMethod<[BigNumberish], void>;
  readonly 'setPeriod(uint256)': WriteMethod<[BigNumberish], void>;
  readonly veKitten: ReadMethod<[], string>;
  readonly 'veKitten()': ReadMethod<[], string>;
  readonly vote: WriteMethod<
    [BigNumberish, readonly AddressLike[], readonly BigNumberish[]],
    void
  >;
  readonly 'vote(uint256,address[],uint256[])': WriteMethod<
    [BigNumberish, readonly AddressLike[], readonly BigNumberish[]],
    void
  >;
  readonly voteCount: ReadMethod<[BigNumberish], bigint>;
  readonly 'voteCount(uint256)': ReadMethod<[BigNumberish], bigint>;
}
export interface MarketReenteringReceiver extends Omit<
  BaseContract,
  'connect' | 'target'
> {
  target: string;
  connect(runner: ContractRunner | null): MarketReenteringReceiver;
  readonly market: ReadMethod<[], string>;
  readonly 'market()': ReadMethod<[], string>;
  readonly onERC721Received: WriteMethod<
    [AddressLike, AddressLike, BigNumberish, BytesLike],
    string
  >;
  readonly 'onERC721Received(address,address,uint256,bytes)': WriteMethod<
    [AddressLike, AddressLike, BigNumberish, BytesLike],
    string
  >;
  readonly reentryReturnData: ReadMethod<[], string>;
  readonly 'reentryReturnData()': ReadMethod<[], string>;
  readonly reentrySucceeded: ReadMethod<[], boolean>;
  readonly 'reentrySucceeded()': ReadMethod<[], boolean>;
  readonly setTarget: WriteMethod<[BigNumberish], void>;
  readonly 'setTarget(uint256)': WriteMethod<[BigNumberish], void>;
  readonly targetListing: ReadMethod<[], bigint>;
  readonly 'targetListing()': ReadMethod<[], bigint>;
}
export interface MarketRejectingReceiver extends Omit<
  BaseContract,
  'connect' | 'target'
> {
  target: string;
  connect(runner: ContractRunner | null): MarketRejectingReceiver;
  readonly onERC721Received: ReadMethod<
    [AddressLike, AddressLike, BigNumberish, BytesLike],
    string
  >;
  readonly 'onERC721Received(address,address,uint256,bytes)': ReadMethod<
    [AddressLike, AddressLike, BigNumberish, BytesLike],
    string
  >;
}
export interface MarketTaxUSDC extends Omit<
  BaseContract,
  'connect' | 'target'
> {
  target: string;
  connect(runner: ContractRunner | null): MarketTaxUSDC;
  readonly allowance: ReadMethod<[AddressLike, AddressLike], bigint>;
  readonly 'allowance(address,address)': ReadMethod<
    [AddressLike, AddressLike],
    bigint
  >;
  readonly approve: WriteMethod<[AddressLike, BigNumberish], boolean>;
  readonly 'approve(address,uint256)': WriteMethod<
    [AddressLike, BigNumberish],
    boolean
  >;
  readonly balanceOf: ReadMethod<[AddressLike], bigint>;
  readonly 'balanceOf(address)': ReadMethod<[AddressLike], bigint>;
  readonly decimals: ReadMethod<[], bigint>;
  readonly 'decimals()': ReadMethod<[], bigint>;
  readonly mint: WriteMethod<[AddressLike, BigNumberish], void>;
  readonly 'mint(address,uint256)': WriteMethod<
    [AddressLike, BigNumberish],
    void
  >;
  readonly name: ReadMethod<[], string>;
  readonly 'name()': ReadMethod<[], string>;
  readonly selectiveTax: ReadMethod<[], boolean>;
  readonly 'selectiveTax()': ReadMethod<[], boolean>;
  readonly setTaxedSender: WriteMethod<[AddressLike], void>;
  readonly 'setTaxedSender(address)': WriteMethod<[AddressLike], void>;
  readonly symbol: ReadMethod<[], string>;
  readonly 'symbol()': ReadMethod<[], string>;
  readonly taxedSender: ReadMethod<[], string>;
  readonly 'taxedSender()': ReadMethod<[], string>;
  readonly totalSupply: ReadMethod<[], bigint>;
  readonly 'totalSupply()': ReadMethod<[], bigint>;
  readonly transfer: WriteMethod<[AddressLike, BigNumberish], boolean>;
  readonly 'transfer(address,uint256)': WriteMethod<
    [AddressLike, BigNumberish],
    boolean
  >;
  readonly transferFrom: WriteMethod<
    [AddressLike, AddressLike, BigNumberish],
    boolean
  >;
  readonly 'transferFrom(address,address,uint256)': WriteMethod<
    [AddressLike, AddressLike, BigNumberish],
    boolean
  >;
}
export interface MarketTestNFT extends Omit<
  BaseContract,
  'connect' | 'target'
> {
  target: string;
  connect(runner: ContractRunner | null): MarketTestNFT;
  readonly approve: WriteMethod<[AddressLike, BigNumberish], void>;
  readonly 'approve(address,uint256)': WriteMethod<
    [AddressLike, BigNumberish],
    void
  >;
  readonly balanceOf: ReadMethod<[AddressLike], bigint>;
  readonly 'balanceOf(address)': ReadMethod<[AddressLike], bigint>;
  readonly getApproved: ReadMethod<[BigNumberish], string>;
  readonly 'getApproved(uint256)': ReadMethod<[BigNumberish], string>;
  readonly isApprovedForAll: ReadMethod<[AddressLike, AddressLike], boolean>;
  readonly 'isApprovedForAll(address,address)': ReadMethod<
    [AddressLike, AddressLike],
    boolean
  >;
  readonly mint: WriteMethod<[AddressLike, BigNumberish], void>;
  readonly 'mint(address,uint256)': WriteMethod<
    [AddressLike, BigNumberish],
    void
  >;
  readonly name: ReadMethod<[], string>;
  readonly 'name()': ReadMethod<[], string>;
  readonly ownerOf: ReadMethod<[BigNumberish], string>;
  readonly 'ownerOf(uint256)': ReadMethod<[BigNumberish], string>;
  readonly safeTransferFrom: WriteMethod<
    [AddressLike, AddressLike, BigNumberish, BytesLike],
    void
  > &
    WriteMethod<[AddressLike, AddressLike, BigNumberish], void>;
  readonly 'safeTransferFrom(address,address,uint256,bytes)': WriteMethod<
    [AddressLike, AddressLike, BigNumberish, BytesLike],
    void
  >;
  readonly 'safeTransferFrom(address,address,uint256)': WriteMethod<
    [AddressLike, AddressLike, BigNumberish],
    void
  >;
  readonly setApprovalForAll: WriteMethod<[AddressLike, boolean], void>;
  readonly 'setApprovalForAll(address,bool)': WriteMethod<
    [AddressLike, boolean],
    void
  >;
  readonly setTransferBlocked: WriteMethod<[BigNumberish, boolean], void>;
  readonly 'setTransferBlocked(uint256,bool)': WriteMethod<
    [BigNumberish, boolean],
    void
  >;
  readonly setVoted: WriteMethod<[BigNumberish, boolean], void>;
  readonly 'setVoted(uint256,bool)': WriteMethod<[BigNumberish, boolean], void>;
  readonly supportsInterface: ReadMethod<[BytesLike], boolean>;
  readonly 'supportsInterface(bytes4)': ReadMethod<[BytesLike], boolean>;
  readonly symbol: ReadMethod<[], string>;
  readonly 'symbol()': ReadMethod<[], string>;
  readonly tokenURI: ReadMethod<[BigNumberish], string>;
  readonly 'tokenURI(uint256)': ReadMethod<[BigNumberish], string>;
  readonly transferBlocked: ReadMethod<[BigNumberish], boolean>;
  readonly 'transferBlocked(uint256)': ReadMethod<[BigNumberish], boolean>;
  readonly transferFrom: WriteMethod<
    [AddressLike, AddressLike, BigNumberish],
    void
  >;
  readonly 'transferFrom(address,address,uint256)': WriteMethod<
    [AddressLike, AddressLike, BigNumberish],
    void
  >;
  readonly voted: ReadMethod<[BigNumberish], boolean>;
  readonly 'voted(uint256)': ReadMethod<[BigNumberish], boolean>;
}
export interface MarketTestUSDC extends Omit<
  BaseContract,
  'connect' | 'target'
> {
  target: string;
  connect(runner: ContractRunner | null): MarketTestUSDC;
  readonly allowance: ReadMethod<[AddressLike, AddressLike], bigint>;
  readonly 'allowance(address,address)': ReadMethod<
    [AddressLike, AddressLike],
    bigint
  >;
  readonly approve: WriteMethod<[AddressLike, BigNumberish], boolean>;
  readonly 'approve(address,uint256)': WriteMethod<
    [AddressLike, BigNumberish],
    boolean
  >;
  readonly balanceOf: ReadMethod<[AddressLike], bigint>;
  readonly 'balanceOf(address)': ReadMethod<[AddressLike], bigint>;
  readonly decimals: ReadMethod<[], bigint>;
  readonly 'decimals()': ReadMethod<[], bigint>;
  readonly mint: WriteMethod<[AddressLike, BigNumberish], void>;
  readonly 'mint(address,uint256)': WriteMethod<
    [AddressLike, BigNumberish],
    void
  >;
  readonly name: ReadMethod<[], string>;
  readonly 'name()': ReadMethod<[], string>;
  readonly symbol: ReadMethod<[], string>;
  readonly 'symbol()': ReadMethod<[], string>;
  readonly totalSupply: ReadMethod<[], bigint>;
  readonly 'totalSupply()': ReadMethod<[], bigint>;
  readonly transfer: WriteMethod<[AddressLike, BigNumberish], boolean>;
  readonly 'transfer(address,uint256)': WriteMethod<
    [AddressLike, BigNumberish],
    boolean
  >;
  readonly transferFrom: WriteMethod<
    [AddressLike, AddressLike, BigNumberish],
    boolean
  >;
  readonly 'transferFrom(address,address,uint256)': WriteMethod<
    [AddressLike, AddressLike, BigNumberish],
    boolean
  >;
}
export type ContractBindings = {
  IRiftwellAlgebraFactory: IRiftwellAlgebraFactory;
  IRiftwellAlgebraPool: IRiftwellAlgebraPool;
  IRiftwellAlgebraRouter: IRiftwellAlgebraRouter;
  RiftwellKittenRewardConverter: RiftwellKittenRewardConverter;
  IRiftwellLoanState: IRiftwellLoanState;
  RiftwellLoanVault: RiftwellLoanVault;
  RiftwellLoans: RiftwellLoans;
  RiftwellMarket: RiftwellMarket;
  IKittenVoter: IKittenVoter;
  IKittenVotingEscrow: IKittenVotingEscrow;
  IKittenVotingReward: IKittenVotingReward;
  ConverterTestFactory: ConverterTestFactory;
  ConverterTestPlugin: ConverterTestPlugin;
  ConverterTestPool: ConverterTestPool;
  ConverterTestRouter: ConverterTestRouter;
  ConverterTestToken: ConverterTestToken;
  FinancedSaleReenteringReceiver: FinancedSaleReenteringReceiver;
  LoanBlacklistUSDC: LoanBlacklistUSDC;
  LoanTestNFT: LoanTestNFT;
  LoanTestReward: LoanTestReward;
  LoanTestVoter: LoanTestVoter;
  MarketReenteringReceiver: MarketReenteringReceiver;
  MarketRejectingReceiver: MarketRejectingReceiver;
  MarketTaxUSDC: MarketTaxUSDC;
  MarketTestNFT: MarketTestNFT;
  MarketTestUSDC: MarketTestUSDC;
};
