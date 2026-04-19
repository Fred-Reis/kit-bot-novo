export interface Property {
  id: string;
  externalId: string;
  ownerId: string;
  name: string;
  address: string;
  complement: string | null;
  neighborhood: string;
  category: string | null;
  description: string | null;
  rent: number;
  deposit: number;
  depositInstallmentsMax: number;
  contractMonths: number | null;
  rooms: number;
  bathrooms: number;
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
