import type { Listing } from './api';

/**
 * Whether a listing matches a marketplace search. Token IDs are decimal and
 * seller addresses hexadecimal, so a number (optionally after "#") matches
 * token IDs by prefix, never digits inside an address. Other text matches the
 * position name, token ID or seller.
 */
export function listingMatches(
  listing: Pick<Listing, 'tokenId' | 'owner'>,
  query: string,
  positionSymbol: string,
): boolean {
  const search = query.trim().toLowerCase();
  if (!search) return true;
  const token = /^#?(\d+)$/.exec(search)?.[1];
  if (token !== undefined) return listing.tokenId.startsWith(token);
  return `${positionSymbol} #${listing.tokenId} ${listing.owner}`
    .toLowerCase()
    .includes(search);
}
