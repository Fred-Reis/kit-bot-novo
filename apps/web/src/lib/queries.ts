import { supabase } from './supabase';
import type { Lead, LeadDocument, Payment, Property, PropertyMedia, Tenant } from '@kit-manager/types';

export async function fetchLeads(): Promise<Lead[]> {
  const { data, error } = await supabase
    .from('Lead')
    .select('*')
    .order('updatedAt', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as Lead[];
}

export async function fetchLead(id: string): Promise<Lead & { documents: LeadDocument[] }> {
  const [{ data: lead, error: leadErr }, { data: docs, error: docsErr }] = await Promise.all([
    supabase.from('Lead').select('*').eq('id', id).single(),
    supabase
      .from('LeadDocument')
      .select('*')
      .eq('leadId', id)
      .order('createdAt', { ascending: true }),
  ]);
  if (leadErr) throw leadErr;
  if (docsErr) throw docsErr;
  return { ...(lead as Lead), documents: (docs as LeadDocument[]) ?? [] };
}

export async function fetchProperties(): Promise<Property[]> {
  const [{ data: props, error: propsErr }, { data: media, error: mediaErr }] = await Promise.all([
    supabase.from('Property').select('*').neq('status', 'archived').order('createdAt', { ascending: true }),
    supabase.from('PropertyMedia').select('*').order('order', { ascending: true }),
  ]);
  if (propsErr) throw propsErr;
  if (mediaErr) throw mediaErr;

  const byProp = ((media as PropertyMedia[]) ?? []).reduce<Record<string, PropertyMedia[]>>(
    (acc, m) => {
      (acc[m.propertyId] ??= []).push(m);
      return acc;
    },
    {},
  );

  return ((props as Property[]) ?? []).map((p) => ({ ...p, media: byProp[p.id] ?? [] }));
}

export async function fetchProperty(id: string): Promise<Property> {
  const [{ data: prop, error: propErr }, { data: media, error: mediaErr }] = await Promise.all([
    supabase.from('Property').select('*').eq('id', id).single(),
    supabase
      .from('PropertyMedia')
      .select('*')
      .eq('propertyId', id)
      .order('order', { ascending: true }),
  ]);
  if (propErr) throw propErr;
  if (mediaErr) throw mediaErr;
  return { ...(prop as Property), media: (media as PropertyMedia[]) ?? [] };
}

export async function fetchTenants(): Promise<Tenant[]> {
  const { data, error } = await supabase
    .from('Tenant')
    .select('*')
    .order('contractStart', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Tenant[];
}

export async function fetchTenant(id: string): Promise<Tenant & { payments: Payment[] }> {
  const [{ data: tenant, error: tenantErr }, { data: payments, error: paymentsErr }] =
    await Promise.all([
      supabase.from('Tenant').select('*').eq('id', id).single(),
      supabase.from('Payment').select('*').eq('tenantId', id).order('month', { ascending: false }),
    ]);
  if (tenantErr) throw tenantErr;
  if (paymentsErr) throw paymentsErr;
  return { ...(tenant as Tenant), payments: (payments as Payment[]) ?? [] };
}

export async function fetchPayments(tenantId: string): Promise<Payment[]> {
  const { data, error } = await supabase
    .from('Payment')
    .select('*')
    .eq('tenantId', tenantId)
    .order('month', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Payment[];
}

export async function fetchAllPayments(): Promise<Payment[]> {
  const { data, error } = await supabase
    .from('Payment')
    .select('*')
    .order('month', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as Payment[];
}
