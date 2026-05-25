import { describe, it, expect } from 'vitest';
import { downsample } from './streams';

describe('downsample', () => {
  it('returns the same array if length <= maxPoints', () => {
    const arr = [1, 2, 3, 4, 5];
    expect(downsample(arr, 10)).toEqual([1, 2, 3, 4, 5]);
  });

  it('preserves first and last point at the right indices', () => {
    const arr = Array.from({ length: 1000 }, (_, i) => i);
    const out = downsample(arr, 100);
    expect(out.length).toBe(100);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(999);
  });

  it('produces evenly spaced indices', () => {
    const arr = Array.from({ length: 100 }, (_, i) => i);
    const out = downsample(arr, 11);
    expect(out.length).toBe(11);
    expect(out[0]).toBe(0);
    expect(out[10]).toBe(99);
    // Stride should be ~9.9, so middle points should be roughly evenly spaced
    expect(out[5]).toBeGreaterThanOrEqual(48);
    expect(out[5]).toBeLessThanOrEqual(51);
  });

  it('handles single max_point', () => {
    expect(downsample([1, 2, 3], 1)).toEqual([1]);
  });

  it('handles empty array', () => {
    expect(downsample([], 100)).toEqual([]);
  });

  it('works on object arrays', () => {
    const arr = [{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }, { v: 5 }, { v: 6 }];
    const out = downsample(arr, 3);
    expect(out.length).toBe(3);
    expect(out[0]).toEqual({ v: 1 });
    expect(out[2]).toEqual({ v: 6 });
  });
});
