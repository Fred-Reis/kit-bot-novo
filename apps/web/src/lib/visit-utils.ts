import type { VisitEntry } from '@/lib/queries';

export type VisitStatus = 'upcoming' | 'unscheduled' | 'completed' | 'cancelled' | 'past';

export function visitStatus(visit: VisitEntry): VisitStatus {
  if (visit.archivedAt != null) return 'cancelled';
  if (visit.visitedAt != null) return 'completed';
  if (visit.scheduledVisitAt == null) return 'unscheduled';
  return new Date(visit.scheduledVisitAt) >= new Date() ? 'upcoming' : 'past';
}
