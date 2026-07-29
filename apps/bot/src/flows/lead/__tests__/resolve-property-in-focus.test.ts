import { describe, expect, it, mock } from 'bun:test';

let referencedPropertyStatus = 'available';
let referencedPropertyActive = true;

mock.module('@/services/catalog', () => ({
  getPropertyByExternalId: async (id: string) =>
    id === 'IM01'
      ? { externalId: 'IM01', name: 'Kitnet Retiro', active: referencedPropertyActive, status: referencedPropertyStatus }
      : null,
  findMatchingProperty: async () => null,
}));

import { resolvePropertyInFocus } from '@/flows/lead/context';

describe('resolvePropertyInFocus', () => {
  it('propertyReference disponível → retorna o imóvel', async () => {
    referencedPropertyStatus = 'available';
    referencedPropertyActive = true;
    const result = await resolvePropertyInFocus({ propertyReference: 'IM01' });
    expect(result?.externalId).toBe('IM01');
  });

  it('propertyReference alugado (status != available) → não trava o foco nele', async () => {
    referencedPropertyStatus = 'rented';
    referencedPropertyActive = true;
    const result = await resolvePropertyInFocus({ propertyReference: 'IM01' });
    expect(result).toBeNull();
  });

  it('propertyReference com status available mas active false → não trava o foco nele', async () => {
    referencedPropertyStatus = 'available';
    referencedPropertyActive = false;
    const result = await resolvePropertyInFocus({ propertyReference: 'IM01' });
    expect(result).toBeNull();
  });
});
