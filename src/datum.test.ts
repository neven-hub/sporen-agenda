import { describe, expect, it } from 'vitest';
import { maandRaster, plusMaanden, maandLabel } from './datum';

describe('maandkalender', () => {
  it('begint op maandag en eindigt op zondag, volledige weken', () => {
    const r = maandRaster('2026-12-15');
    expect(r[0]).toBe('2026-11-30'); // maandag
    expect(r.at(-1)).toBe('2027-01-03'); // zondag
    expect(r.length % 7).toBe(0);
  });
  it('maand die op maandag begint', () => {
    const r = maandRaster('2027-02-10'); // 1 feb 2027 is een maandag
    expect(r[0]).toBe('2027-02-01');
    expect(r.at(-1)).toBe('2027-02-28');
    expect(r).toHaveLength(28);
  });
  it('maanden verspringen over de jaargrens', () => {
    expect(plusMaanden('2026-12-31', 1)).toBe('2027-01-01');
    expect(plusMaanden('2026-01-15', -1)).toBe('2025-12-01');
    expect(maandLabel('2026-11-01')).toBe('november 2026');
  });
});
