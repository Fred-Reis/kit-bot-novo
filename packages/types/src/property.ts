export interface Property {
  id: string;
  externalId: string;
  ownerId: string;
  name: string;
  title: string | null;
  address: string;
  complement: string | null;
  neighborhood: string;
  category: string | null;
  type: string | null;
  purpose: string | null;
  status: 'available' | 'rented' | 'maintenance' | 'reserved';
  description: string | null;
  rent: number;
  deposit: number;
  depositInstallmentsMax: number;
  contractMonths: number | null;
  rooms: number;
  bathrooms: number;
  area: number | null;
  parkingSpots: number | null;
  amenities: string[];
  includesWater: boolean;
  includesIptu: boolean;
  individualElectricity: boolean;
  firstRental: boolean;
  independentEntrance: boolean;
  acceptsPets: boolean;
  maxAdults: number;
  acceptsChildren: boolean;
  visitSchedule: string | null;
  listingUrl: string | null;
  rulesText: string | null;
  active: boolean;
  media: PropertyMedia[];
  createdAt: string;
  updatedAt: string;
}

export interface PropertyMedia {
  id: string;
  propertyId: string;
  type: 'photo' | 'video' | 'listing';
  url: string;
  label: string | null;
  order: number;
  createdAt: string;
}

export interface Owner {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  createdAt: string;
}
