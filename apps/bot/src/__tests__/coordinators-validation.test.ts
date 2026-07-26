import { describe, expect, test } from 'bun:test';
import { validateResponsibilities } from '@/lib/coordinator-responsibilities';

describe('validateResponsibilities', () => {
  test('aceita array com valores válidos', () => {
    expect(validateResponsibilities(['show_property', 'inspection'])).toEqual([
      'show_property',
      'inspection',
    ]);
  });

  test('aceita array vazio', () => {
    expect(validateResponsibilities([])).toEqual([]);
  });

  test('rejeita valor inválido', () => {
    expect(validateResponsibilities(['show_property', 'lava_louca'])).toBeNull();
  });

  test('rejeita não-array', () => {
    expect(validateResponsibilities('show_property')).toBeNull();
    expect(validateResponsibilities(undefined)).toBeNull();
  });
});
