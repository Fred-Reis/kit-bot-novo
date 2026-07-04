import { describe, expect, it } from 'bun:test';
import { parseIncomeValue } from '@/flows/lead/income';

describe('parseIncomeValue', () => {
  it('número puro', () => expect(parseIncomeValue('12000')).toBe(12000));
  it('formato brasileiro', () => expect(parseIncomeValue('R$ 1.234,56')).toBe(1234.56));
  it('milhar com ponto', () => expect(parseIncomeValue('12.000')).toBe(12000));
  it('"3 mil"', () => expect(parseIncomeValue('3 mil')).toBe(3000));
  it('"2,5 mil"', () => expect(parseIncomeValue('2,5 mil')).toBe(2500));
  it('lixo → null', () => expect(parseIncomeValue('não sei')).toBeNull());
  it('null → null', () => expect(parseIncomeValue(null)).toBeNull());
  it('zero/negativo → null', () => expect(parseIncomeValue('0')).toBeNull());
});
