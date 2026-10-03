import { describe, expect, it } from 'vitest';
import { parseHash, routeHash } from './router';

describe('hash routes', () => {
  it('opens known pages and the fallback for an empty hash', () => {
    expect(parseHash('')).toEqual({ page: 'borrow', item: null });
    expect(parseHash('#')).toEqual({ page: 'borrow', item: null });
    expect(parseHash('#earn')).toEqual({ page: 'earn', item: null });
    expect(parseHash('#stats')).toEqual({ page: 'stats', item: null });
    expect(parseHash('#privacy', 'earn')).toEqual({
      page: 'privacy',
      item: null,
    });
    expect(parseHash('', 'earn')).toEqual({ page: 'earn', item: null });
  });

  it('maps the former lending route to Borrow', () => {
    const route = parseHash('#lending');
    expect(route).toEqual({ page: 'borrow', item: null });
    expect(routeHash(route)).toBe('#borrow');
  });

  it('accepts listing deep links only on the marketplace', () => {
    expect(parseHash('#marketplace/027')).toEqual({
      page: 'marketplace',
      item: '027',
    });
    expect(routeHash({ page: 'marketplace', item: '027' })).toBe(
      '#marketplace/027',
    );
    expect(parseHash('#earn/027').page).toBe('not-found');
    expect(parseHash('#marketplace/BAD!').page).toBe('not-found');
    expect(parseHash('#marketplace/1/2').page).toBe('not-found');
  });

  it('keeps unknown hashes as not-found routes', () => {
    const route = parseHash('#nowhere');
    expect(route).toEqual({ page: 'not-found', item: 'nowhere' });
    expect(routeHash(route)).toBe('#nowhere');
    expect(parseHash(`#${'x'.repeat(500)}`).item).toHaveLength(200);
  });
});
