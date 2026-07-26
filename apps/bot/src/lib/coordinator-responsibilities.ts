export const VALID_RESPONSIBILITIES = new Set([
  'show_property',
  'deliver_keys',
  'receive_keys',
  'inspection',
]);

export function validateResponsibilities(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((v) => typeof v === 'string' && VALID_RESPONSIBILITIES.has(v))) return null;
  return value as string[];
}
