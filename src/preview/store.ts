import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ASSETS,
  collateralLimits,
  LISTING_IDS,
  LISTINGS,
  positionView,
  STARTING_POSITION_IDS,
  assetById,
} from '../data';
import {
  emptyPortfolio,
  LEGACY_STORAGE_KEY,
  parsePortfolio,
  STORAGE_KEY,
  type Asset,
  type Portfolio,
} from '../domain';
import {
  createLendingState,
  parseLendingState,
  type LendingState,
} from '../lending';
import {
  emptyListingBook,
  liveListings,
  LISTINGS_STORAGE_KEY,
  parseListingBook,
  type ListingBook,
  type PreviewListing,
} from '../listings';
import {
  defaultVotePlan,
  parseVotePlan,
  VOTE_STORAGE_KEY,
  type VotePlan,
} from '../vote';

export const LENDING_STORAGE_KEY = 'riftwell.pooled-lending-preview.v1';
const ASSET_IDS = ASSETS.map((asset) => asset.id);

type Loaded = {
  portfolio: Portfolio;
  lending: LendingState;
  listings: ListingBook;
  votes: VotePlan;
  readIssue: boolean;
  migrated: boolean;
};

function load(): Loaded {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    const legacy =
      current === null ? localStorage.getItem(LEGACY_STORAGE_KEY) : null;
    return {
      portfolio: parsePortfolio(current ?? legacy, LISTING_IDS),
      lending: parseLendingState(
        localStorage.getItem(LENDING_STORAGE_KEY),
        collateralLimits,
      ),
      listings: parseListingBook(
        localStorage.getItem(LISTINGS_STORAGE_KEY),
        ASSET_IDS,
      ),
      votes: parseVotePlan(localStorage.getItem(VOTE_STORAGE_KEY)),
      readIssue: false,
      migrated: legacy !== null,
    };
  } catch {
    return {
      portfolio: emptyPortfolio(),
      lending: createLendingState(),
      listings: emptyListingBook(),
      votes: defaultVotePlan(),
      readIssue: true,
      migrated: false,
    };
  }
}

/** Load, validate and persist every preview store with one storage notice. */
export function usePreviewStore() {
  const [initial] = useState(load);
  const [portfolio, setPortfolio] = useState(initial.portfolio);
  const [lending, setLendingState] = useState(initial.lending);
  const [listings, setListings] = useState(initial.listings);
  const [votes, setVotes] = useState(initial.votes);
  const [storageIssue, setStorageIssue] = useState(initial.readIssue);
  const lendingRef = useRef(lending);
  lendingRef.current = lending;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(portfolio));
      localStorage.setItem(LENDING_STORAGE_KEY, JSON.stringify(lending));
      localStorage.setItem(LISTINGS_STORAGE_KEY, JSON.stringify(listings));
      localStorage.setItem(VOTE_STORAGE_KEY, JSON.stringify(votes));
      setStorageIssue(initial.readIssue);
    } catch {
      setStorageIssue(true);
    }
  }, [portfolio, lending, listings, votes, initial.readIssue]);

  /** Commit a ledger state synchronously so chained actions read the latest. */
  function setLending(next: LendingState) {
    lendingRef.current = next;
    setLendingState(next);
  }

  function reset() {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      setStorageIssue(true);
    }
    setPortfolio(emptyPortfolio());
    setLending(createLendingState());
    setListings(emptyListingBook());
    setVotes(defaultVotePlan());
  }

  return {
    portfolio,
    setPortfolio,
    lending,
    lendingRef,
    setLending,
    listings,
    setListings,
    votes,
    setVotes,
    storageIssue,
    migrated: initial.migrated,
    reset,
  };
}

export type Holdings = {
  /** Every position you hold, as it stands after merges and increases. */
  owned: Asset[];
  wallet: Asset[];
  collateral: Asset[];
  /** Positions in the reward relayer: collecting rewards, no credit. */
  relayer: Asset[];
  listed: { asset: Asset; listing: PreviewListing }[];
  market: Asset[];
  purchasedIds: Set<string>;
};

/** Where each sample position currently sits. */
export function useHoldings(
  portfolio: Portfolio,
  lending: LendingState,
  listings: ListingBook,
  now: number,
): Holdings {
  const { lockIncreases, mergedInto } = lending;
  return useMemo(() => {
    const changes = { lockIncreases, mergedInto };
    const view = (ids: readonly string[]) =>
      ids
        .map(assetById)
        .filter((asset): asset is Asset => asset !== undefined)
        .map((asset) => positionView(asset, changes));
    const purchasedIds = new Set(
      portfolio.receipts.map((receipt) => receipt.assetId),
    );
    // Merged positions live on inside the position they joined.
    const ownedIds = [...STARTING_POSITION_IDS, ...purchasedIds].filter(
      (id) => !Object.hasOwn(mergedInto, id),
    );
    const owned = view(ownedIds);
    const live = liveListings(listings, now).filter((listing) =>
      ownedIds.includes(listing.assetId),
    );
    const collateral = view(lending.collateralIds);
    const relayer = view(lending.relayerIds);
    const engaged = new Set([...lending.collateralIds, ...lending.relayerIds]);
    const listed = live.flatMap((listing) => {
      const asset = owned.find((item) => item.id === listing.assetId);
      return asset && !engaged.has(asset.id) ? [{ asset, listing }] : [];
    });
    const wallet = owned.filter(
      (asset) =>
        !engaged.has(asset.id) &&
        !listed.some((item) => item.asset.id === asset.id),
    );
    const market = LISTINGS.filter((asset) => !purchasedIds.has(asset.id));
    return { owned, wallet, collateral, relayer, listed, market, purchasedIds };
  }, [
    portfolio,
    lending.collateralIds,
    lending.relayerIds,
    lockIncreases,
    mergedInto,
    listings,
    now,
  ]);
}
