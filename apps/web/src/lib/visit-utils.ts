import type { VisitEntry } from '@/lib/queries';

export type VisitStatus = 'upcoming' | 'unscheduled' | 'completed' | 'cancelled' | 'past';

// Supabase returns timestamp columns without timezone suffix.
// Without 'Z', browsers treat the string as local time — force UTC.
export function parseDbDate(iso: string | null): Date | null {
  if (!iso) return null;
  const normalized = /[Z+]/.test(iso) ? iso : `${iso}Z`;
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}

export function visitStatus(visit: VisitEntry): VisitStatus {
  if (visit.archivedAt != null) return 'cancelled';
  if (visit.visitedAt != null) return 'completed';
  if (visit.scheduledVisitAt == null) return 'unscheduled';
  const d = parseDbDate(visit.scheduledVisitAt);
  return d && d >= new Date() ? 'upcoming' : 'past';
}
