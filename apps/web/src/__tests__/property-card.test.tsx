import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PropertyCard } from '@/components/property-card';
import type { Property } from '@kit-manager/types';

function makeProperty(overrides: Partial<Property> = {}): Property {
  return {
    id: 'prop-1',
    externalId: 'AP-101',
    ownerId: 'owner-1',
    name: 'Apartamento Centro',
    title: null,
    address: 'Rua das Flores, 100',
    complement: null,
    neighborhood: 'Centro',
    category: null,
    type: null,
    purpose: null,
    status: 'available',
    description: null,
    rent: 1800,
    deposit: 1800,
    depositInstallmentsMax: 3,
    contractMonths: 12,
    rooms: 2,
    bathrooms: 1,
    area: null,
    parkingSpots: null,
    amenities: [],
    includesWater: false,
    includesIptu: false,
    individualElectricity: true,
    firstRental: false,
    independentEntrance: true,
    acceptsPets: false,
    maxAdults: 3,
    acceptsChildren: true,
    visitSchedule: null,
    listingUrl: null,
    rulesText: null,
    active: true,
    media: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('PropertyCard — status pills', () => {
  test('status=available shows "Disponível"', () => {
    render(<PropertyCard property={makeProperty({ status: 'available' })} />);
    expect(screen.getByText('Disponível')).toBeInTheDocument();
  });

  test('status=rented shows "Alugado"', () => {
    render(<PropertyCard property={makeProperty({ status: 'rented' })} />);
    expect(screen.getByText('Alugado')).toBeInTheDocument();
  });

  test('status=maintenance shows "Manutenção"', () => {
    render(<PropertyCard property={makeProperty({ status: 'maintenance' })} />);
    expect(screen.getByText('Manutenção')).toBeInTheDocument();
  });

  test('status=reserved shows "Reservado"', () => {
    render(<PropertyCard property={makeProperty({ status: 'reserved' })} />);
    expect(screen.getByText('Reservado')).toBeInTheDocument();
  });
});

describe('PropertyCard — grid variant', () => {
  test('renders property name', () => {
    render(<PropertyCard property={makeProperty()} />);
    expect(screen.getByText('Apartamento Centro')).toBeInTheDocument();
  });

  test('renders formatted rent', () => {
    render(<PropertyCard property={makeProperty({ rent: 2500 })} />);
    expect(screen.getByText(/2\.500/)).toBeInTheDocument();
  });

  test('renders rooms and bathrooms', () => {
    render(<PropertyCard property={makeProperty({ rooms: 3, bathrooms: 2 })} />);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  test('renders area when non-null', () => {
    render(<PropertyCard property={makeProperty({ area: 75 })} />);
    expect(screen.getByText(/75m²/)).toBeInTheDocument();
  });

  test('does not render area when null', () => {
    render(<PropertyCard property={makeProperty({ area: null })} />);
    expect(screen.queryByText(/m²/)).not.toBeInTheDocument();
  });

  test('has data-slot="property-card"', () => {
    const { container } = render(<PropertyCard property={makeProperty()} />);
    expect(container.querySelector('[data-slot="property-card"]')).toBeInTheDocument();
  });
});

describe('PropertyCard — row variant', () => {
  test('renders row variant with name and rent', () => {
    render(<PropertyCard property={makeProperty({ rent: 1200 })} variant="row" />);
    expect(screen.getByText('Apartamento Centro')).toBeInTheDocument();
    expect(screen.getByText(/1\.200/)).toBeInTheDocument();
  });

  test('row variant has data-variant="row"', () => {
    const { container } = render(<PropertyCard property={makeProperty()} variant="row" />);
    expect(container.querySelector('[data-variant="row"]')).toBeInTheDocument();
  });

  test('row variant shows externalId', () => {
    render(<PropertyCard property={makeProperty({ externalId: 'IM-0042' })} variant="row" />);
    expect(screen.getByText('IM-0042')).toBeInTheDocument();
  });

  test('row variant shows neighborhood', () => {
    render(<PropertyCard property={makeProperty({ neighborhood: 'Vila Madalena' })} variant="row" />);
    expect(screen.getByText(/Vila Madalena/)).toBeInTheDocument();
  });
});

describe('PropertyCard — cover photo placeholder', () => {
  test('shows hatched SVG placeholder when no media', () => {
    const { container } = render(<PropertyCard property={makeProperty({ media: [] })} />);
    expect(container.querySelector('[data-slot="placeholder"]')).toBeInTheDocument();
  });

  test('shows img when media has a photo', () => {
    const property = makeProperty({
      media: [{ id: 'm1', propertyId: 'prop-1', url: 'https://example.com/photo.jpg', type: 'photo', label: null, order: 0, createdAt: '2026-01-01T00:00:00Z' }],
    });
    render(<PropertyCard property={property} />);
    expect(screen.getByRole('img')).toBeInTheDocument();
  });
});

describe('PropertyCard — address format', () => {
  test('grid shows address with neighborhood separator', () => {
    render(<PropertyCard property={makeProperty({ address: 'Rua das Flores, 100', neighborhood: 'Centro' })} />);
    expect(screen.getByText('Rua das Flores, 100 — Centro')).toBeInTheDocument();
  });
});
