import { describe, expect, it } from 'bun:test';
import { buildReceiptMessage } from '@/flows/lead/receipt';

describe('buildReceiptMessage', () => {
  it('retorna null para zero documentos', () => {
    expect(buildReceiptMessage(0)).toBeNull();
  });

  it('singular para 1 documento', () => {
    expect(buildReceiptMessage(1)).toBe('📄 Recebi seu documento!');
  });

  it('plural para 2+', () => {
    expect(buildReceiptMessage(3)).toBe('📄 Recebi 3 documentos!');
  });
});
