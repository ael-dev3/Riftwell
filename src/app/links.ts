import type { Asset } from '../domain';

/** A shareable deep link that opens a listing's details. */
export function assetLink(asset: Asset) {
  const url = new URL(window.location.href);
  url.hash = `#marketplace/${asset.positionId}`;
  return url.href;
}

/** Copy text, reporting success or failure without throwing. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
