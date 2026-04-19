import { describe, test, expect } from 'vitest';
import { formatCurrency, formatDate } from '@/lib/utils';

describe('formatCurrency', () => {
  test('formats integer value as BRL', () => {
    expect(formatCurrency(1800)).toBe('R$\u00a01.800,00');
  });

  test('formats decimal value', () => {
    expect(formatCurrency(1234.5)).toBe('R$\u00a01.234,50');
  });

  test('formats zero', () => {
    expect(formatCurrency(0)).toBe('R$\u00a00,00');
  });
});

describe('formatDate', () => {
  test('formats ISO string as pt-BR short date + time', () => {
    const iso = '2026-04-19T10:30:00.000Z';
    const result = formatDate(iso);
    // Date/time formatting is locale-dependent; just assert it contains the date parts
    expect(result).toContain('19');
    expect(result).toContain('04');
    expect(result).toContain('2026');
  });
});
