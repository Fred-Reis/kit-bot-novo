import { describe, test, expect } from 'vitest';
import { tenantStatus } from '@/lib/tenant-utils';

describe('tenantStatus', () => {
  test('returns ok when onTimeRate >= 80', () => {
    expect(tenantStatus(80)).toBe('ok');
    expect(tenantStatus(100)).toBe('ok');
    expect(tenantStatus(95.5)).toBe('ok');
  });

  test('returns attention when onTimeRate < 80', () => {
    expect(tenantStatus(79)).toBe('attention');
    expect(tenantStatus(0)).toBe('attention');
    expect(tenantStatus(50)).toBe('attention');
  });

  test('returns null when onTimeRate is null', () => {
    expect(tenantStatus(null)).toBeNull();
  });
});
