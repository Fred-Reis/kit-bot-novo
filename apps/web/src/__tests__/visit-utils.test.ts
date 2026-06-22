import { describe, test, expect } from 'vitest';
import { visitStatus } from '@/lib/visit-utils';
import type { VisitEntry } from '@/lib/queries';

const BASE: VisitEntry = {
  id: 'lead-1',
  externalId: 'LD-0001',
  name: 'João Silva',
  phone: '5511999999999@s.whatsapp.net',
  stage: 'visiting',
  scheduledVisitAt: null,
  visitedAt: null,
  archivedAt: null,
  propertyId: null,
  property: null,
};

const future = new Date(Date.now() + 86_400_000).toISOString(); // +1 day
const past = new Date(Date.now() - 86_400_000).toISOString(); // -1 day

describe('visitStatus', () => {
  test('archivedAt set → cancelled (regardless of other fields)', () => {
    expect(visitStatus({ ...BASE, scheduledVisitAt: future, archivedAt: past })).toBe('cancelled');
  });

  test('visitedAt set (no archivedAt) → completed', () => {
    expect(visitStatus({ ...BASE, scheduledVisitAt: past, visitedAt: past })).toBe('completed');
  });

  test('scheduledVisitAt in future → upcoming', () => {
    expect(visitStatus({ ...BASE, scheduledVisitAt: future })).toBe('upcoming');
  });

  test('scheduledVisitAt in past, not visited, not archived → past', () => {
    expect(visitStatus({ ...BASE, scheduledVisitAt: past })).toBe('past');
  });

  test('scheduledVisitAt null → unscheduled', () => {
    expect(visitStatus({ ...BASE, scheduledVisitAt: null })).toBe('unscheduled');
  });

  test('cancelled takes priority over completed', () => {
    expect(visitStatus({ ...BASE, visitedAt: past, archivedAt: past })).toBe('cancelled');
  });
});
