export function tenantStatus(onTimeRate: number | null): 'ok' | 'attention' | null {
  if (onTimeRate == null) return null;
  return onTimeRate >= 80 ? 'ok' : 'attention';
}
