import { http, HttpResponse } from 'msw';
import type { Lead, LeadDocument, Property, Tenant } from '@kit-manager/types';

const MOCK_PROPERTIES: Property[] = [
  {
    id: 'prop-1',
    externalId: 'KIT-01',
    ownerId: 'owner-1',
    name: 'Quitinete Retiro',
    address: 'Rua das Flores, 42',
    complement: 'Apto 5',
    neighborhood: 'Retiro',
    category: 'quitinete',
    description: 'Quitinete mobiliada com entrada independente.',
    rent: 900,
    deposit: 900,
    depositInstallmentsMax: 3,
    contractMonths: 6,
    rooms: 1,
    bathrooms: 1,
    includesWater: true,
    includesIptu: true,
    individualElectricity: true,
    firstRental: false,
    independentEntrance: true,
    acceptsPets: false,
    maxAdults: 2,
    acceptsChildren: true,
    visitSchedule: 'Seg–Sex 9h–18h',
    listingUrl: 'https://olx.com.br/...',
    rulesText: null,
    active: true,
    media: [],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
];

const MOCK_LEADS: Lead[] = [
  {
    id: 'lead-1',
    phone: '5527999990001',
    propertyId: 'prop-1',
    stage: 'kyc_pending',
    contractUrl: null,
    autentiqueDocId: null,
    visitedAt: '2024-03-10T14:00:00Z',
    docsSentAt: '2024-03-12T10:00:00Z',
    contractSignedAt: null,
    createdAt: '2024-03-01T00:00:00Z',
    updatedAt: '2024-03-12T10:00:00Z',
  },
  {
    id: 'lead-2',
    phone: '5527999990002',
    propertyId: 'prop-1',
    stage: 'collection',
    contractUrl: null,
    autentiqueDocId: null,
    visitedAt: '2024-03-15T10:00:00Z',
    docsSentAt: null,
    contractSignedAt: null,
    createdAt: '2024-03-05T00:00:00Z',
    updatedAt: '2024-03-15T10:00:00Z',
  },
  {
    id: 'lead-3',
    phone: '5527999990003',
    propertyId: 'prop-1',
    stage: 'residents_docs_complete',
    contractUrl: null,
    autentiqueDocId: null,
    visitedAt: '2024-03-08T09:00:00Z',
    docsSentAt: '2024-03-10T11:00:00Z',
    contractSignedAt: null,
    createdAt: '2024-02-20T00:00:00Z',
    updatedAt: '2024-03-11T09:00:00Z',
  },
];

const MOCK_DOCS: LeadDocument[] = [
  {
    id: 'doc-1',
    leadId: 'lead-1',
    type: 'cnh',
    url: 'https://placehold.co/400x250/e5e5e5/666?text=CNH+Frente',
    ocrText: 'JOSE DA SILVA\nCPF: 123.456.789-00\nRG: 12.345.678-9',
    createdAt: '2024-03-12T10:00:00Z',
  },
  {
    id: 'doc-2',
    leadId: 'lead-1',
    type: 'cnh',
    url: 'https://placehold.co/400x250/e5e5e5/666?text=CNH+Verso',
    ocrText: 'Validade: 12/2030\nCategoria: B',
    createdAt: '2024-03-12T10:05:00Z',
  },
];

const MOCK_TENANTS: Tenant[] = [
  {
    id: 'tenant-1',
    phone: '5527999990099',
    propertyId: 'prop-1',
    contractStart: '2023-06-01T00:00:00Z',
    contractEnd: null,
    createdAt: '2023-06-01T00:00:00Z',
  },
];

export const handlers = [
  // Leads
  http.get('/api/leads', () => HttpResponse.json(MOCK_LEADS)),
  http.get('/api/leads/:id', ({ params }) => {
    const lead = MOCK_LEADS.find((l) => l.id === params.id);
    if (!lead) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json({ ...lead, documents: MOCK_DOCS.filter((d) => d.leadId === lead.id) });
  }),

  // Properties
  http.get('/api/properties', () => HttpResponse.json(MOCK_PROPERTIES)),
  http.get('/api/properties/:id', ({ params }) => {
    const property = MOCK_PROPERTIES.find((p) => p.id === params.id);
    if (!property) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(property);
  }),

  // Tenants
  http.get('/api/tenants', () => HttpResponse.json(MOCK_TENANTS)),

  // Admin actions (bot endpoints — mocked until Phase 4)
  http.post('/admin/leads/:id/approve-kyc', () => HttpResponse.json({ success: true })),
  http.post('/admin/leads/:id/generate-contract', () => HttpResponse.json({ success: true })),
  http.post('/admin/leads/:id/confirm-payment', () => HttpResponse.json({ success: true })),
];
