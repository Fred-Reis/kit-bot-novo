export function parseIncomeValue(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const t = raw.toLowerCase().replace(/r\$/g, '').trim();

  const milMatch = /^(\d+(?:[.,]\d+)?)\s*mil$/.exec(t);
  if (milMatch) {
    const base = parseFloat(milMatch[1].replace(',', '.'));
    return Number.isFinite(base) && base > 0 ? Math.round(base * 1000) : null;
  }

  const cleaned = t.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '');
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}
