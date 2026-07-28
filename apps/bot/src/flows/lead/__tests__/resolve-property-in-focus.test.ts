import { describe, expect, it, mock } from 'bun:test';

let referencedPropertyStatus = 'available';

mock.module('@/services/catalog', () => ({
  getPropertyByExternalId: async (id: string) =>
    id === 'IM01' ? { externalId: 'IM01', name: 'Kitnet Retiro', active: true, status: referencedPropertyStatus } : null,
  findMatchingProperty: async () => null,
}));

import { resolvePropertyInFocus } from '@/flows/lead/context';

describe('resolvePropertyInFocus', () => {
  it('propertyReference disponível → retorna o imóvel', async () => {
    referencedPropertyStatus = 'available';
    const result = await resolvePropertyInFocus({ propertyReference: 'IM01' });
    expect(result?.externalId).toBe('IM01');
  });

  it('propertyReference alugado (status != available) → não trava o foco nele', async () => {
    referencedPropertyStatus = 'rented';
    const result = await resolvePropertyInFocus({ propertyReference: 'IM01' });
    expect(result).toBeNull();
  });
});
