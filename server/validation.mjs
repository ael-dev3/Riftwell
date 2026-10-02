import { getAddress } from 'ethers';
import { fail } from './errors.mjs';

export function fields(value, allowed, optional = false) {
  if (value === undefined && optional) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail(400, 'INVALID_REQUEST', 'An object is required.');
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    fail(400, 'UNKNOWN_FIELD', 'The request contains an unsupported field.');
  return value;
}

export function address(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value))
    fail(400, 'INVALID_ADDRESS', 'A valid Ethereum address is required.');
  try {
    return getAddress(value);
  } catch {
    fail(400, 'INVALID_ADDRESS', 'A valid Ethereum address is required.');
  }
}

export function tokenId(value) {
  if (
    typeof value !== 'string' ||
    !/^[1-9][0-9]{0,77}$/.test(value) ||
    BigInt(value) > (1n << 256n) - 1n
  )
    fail(
      400,
      'INVALID_TOKEN_ID',
      'Token IDs must be canonical decimal uint256 strings.',
    );
  return value;
}

export function uuid(value, name = 'ID') {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    fail(400, 'INVALID_ID', `${name} must be a UUID.`);
  return value.toLowerCase();
}

export function money(value) {
  if (
    typeof value !== 'string' ||
    !/^[1-9][0-9]{0,12}$/.test(value) ||
    BigInt(value) < 1_000_000n ||
    BigInt(value) > 1_000_000_000_000n
  )
    fail(
      400,
      'INVALID_AMOUNT',
      'Amounts must be decimal raw-unit strings between 1 and 1,000,000 USDC.',
    );
  return value;
}

export function apr(value) {
  if (!Number.isSafeInteger(value) || value < 100 || value > 4000)
    fail(
      400,
      'INVALID_APR',
      'APR must be an integer from 100 to 4,000 basis points.',
    );
  return value;
}

export function duration(value) {
  if (!Number.isSafeInteger(value) || ![7, 14, 30].includes(value))
    fail(400, 'INVALID_DURATION', 'Duration must be 7, 14 or 30 days.');
  return value;
}

export function expiry(value, now) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  )
    fail(400, 'INVALID_EXPIRY', 'Expiry must be a UTC ISO date.');
  const millis = Date.parse(value);
  if (
    !Number.isFinite(millis) ||
    new Date(millis).toISOString().replace('.000Z', 'Z') !==
      value.replace('.000Z', 'Z') ||
    millis <= now ||
    millis > now + 30 * 86400000
  )
    fail(400, 'INVALID_EXPIRY', 'Expiry must be in the next 30 days.');
  return millis;
}

export function limit(value) {
  if (value === undefined) return 24;
  if (
    typeof value !== 'string' ||
    !/^[1-9][0-9]?$/.test(value) ||
    Number(value) > 50
  )
    fail(400, 'INVALID_PAGINATION', 'Limit must be from 1 to 50.');
  return Number(value);
}

export function sameOwner(a, b) {
  return (
    typeof a === 'string' &&
    typeof b === 'string' &&
    a.toLowerCase() === b.toLowerCase()
  );
}
