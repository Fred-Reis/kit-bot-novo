import { describe, expect, test } from 'vitest';
import { addUtcSuffixDeep } from '@/lib/supabase-timestamp-fix';

describe('addUtcSuffixDeep', () => {
  test('adiciona Z num timestamp sem timezone', () => {
    expect(addUtcSuffixDeep('2026-08-02T00:29:51.321')).toBe('2026-08-02T00:29:51.321Z');
  });

  test('adiciona Z num timestamp sem milissegundos', () => {
    expect(addUtcSuffixDeep('2026-08-02T00:29:51')).toBe('2026-08-02T00:29:51Z');
  });

  test('não mexe num timestamp que já tem Z', () => {
    expect(addUtcSuffixDeep('2026-08-02T00:29:51.321Z')).toBe('2026-08-02T00:29:51.321Z');
  });

  test('não mexe num timestamp que já tem offset explícito', () => {
    expect(addUtcSuffixDeep('2026-08-02T00:29:51.321-03:00')).toBe('2026-08-02T00:29:51.321-03:00');
  });

  test('não mexe numa string de data pura (sem hora)', () => {
    expect(addUtcSuffixDeep('2026-08-02')).toBe('2026-08-02');
  });

  test('não mexe numa string qualquer que não parece timestamp', () => {
    expect(addUtcSuffixDeep('Vazamento sob a pia')).toBe('Vazamento sob a pia');
  });

  test('percorre objetos aninhados', () => {
    expect(addUtcSuffixDeep({ createdAt: '2026-08-02T00:29:51.321', name: 'Maria' })).toEqual({
      createdAt: '2026-08-02T00:29:51.321Z',
      name: 'Maria',
    });
  });

  test('percorre arrays de objetos', () => {
    expect(
      addUtcSuffixDeep([
        { createdAt: '2026-08-02T00:29:51.321' },
        { createdAt: '2026-08-01T10:00:00' },
      ]),
    ).toEqual([{ createdAt: '2026-08-02T00:29:51.321Z' }, { createdAt: '2026-08-01T10:00:00Z' }]);
  });

  test('valores não-string (number, boolean, null) passam intactos', () => {
    expect(addUtcSuffixDeep({ score: 10, active: true, deletedAt: null })).toEqual({
      score: 10,
      active: true,
      deletedAt: null,
    });
  });
});
