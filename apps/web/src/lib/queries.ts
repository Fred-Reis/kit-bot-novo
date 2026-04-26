import { supabase } from './supabase';
import type { Lead, LeadDocument, Payment, Property, PropertyMedia, RuleSetDetail, RuleSetSummary, Tenant } from '@kit-manager/types';
import { tenantStatus } from './tenant-utils';

type TenantRow = Omit<Tenant, 'propertyName' | 'status'> & { property: { name: string } | null };

function mapTenantRow(row: TenantRow): Tenant {
  return { ...row, propertyName: row.property?.name ?? null, status: tenantStatus(row.onTimeRate) };
}

type LeadRow = Omit<Lead, 'propertyExternalId'> & { property: { externalId: string } | null };

function mapLeadRow(row: LeadRow): Lead {
  return { ...row, propertyExternalId: row.property?.externalId ?? null };
}

export async function fetchLeads(): Promise<Lead[]> {
  const { data, error } = await supabase
    .from('Lead')
    .select('*, property:Property(externalId)')
    .order('updatedAt', { ascending: false })
    .limit(100);
  if (error) throw error;
  return ((data ?? []) as LeadRow[]).map(mapLeadRow);
}

export async function fetchLead(id: string): Promise<Lead & { documents: LeadDocument[] }> {
  const [{ data: lead, error: leadErr }, { data: docs, error: docsErr }] = await Promise.all([
    supabase.from('Lead').select('*, property:Property(externalId)').eq('id', id).single(),
    supabase.from('LeadDocument').select('*').eq('leadId', id).order('createdAt', { ascending: true }),
  ]);
  if (leadErr) throw leadErr;
  if (docsErr) throw docsErr;
  return { ...mapLeadRow(lead as LeadRow), documents: (docs as LeadDocument[]) ?? [] };
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
    .select('*, property:Property(name)')
    .order('contractStart', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as TenantRow[]).map(mapTenantRow);
}

export async function fetchTenant(id: string): Promise<Tenant & { payments: Payment[] }> {
  const [{ data: tenant, error: tenantErr }, { data: payments, error: paymentsErr }] =
    await Promise.all([
      supabase.from('Tenant').select('*, property:Property(name)').eq('id', id).single(),
      supabase.from('Payment').select('*').eq('tenantId', id).order('month', { ascending: false }),
    ]);
  if (tenantErr) throw tenantErr;
  if (paymentsErr) throw paymentsErr;
  return { ...mapTenantRow(tenant as TenantRow), payments: (payments as Payment[]) ?? [] };
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

export interface ActivityLogEntry {
  id: string;
  actor: string | null;
  action: string;
  subject: string | null;
  subjectType: string | null;
  createdAt: string;
}

export async function fetchActivityLog(limit = 10): Promise<ActivityLogEntry[]> {
  const { data, error } = await supabase
    .from('ActivityLog')
    .select('id, actor, action, subject, subjectType, createdAt')
    .order('createdAt', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ActivityLogEntry[];
}

export async function fetchRuleSets(): Promise<RuleSetSummary[]> {
  const { data, error } = await supabase
    .from('RuleSet')
    .select('*, policies:RuleSetPolicy(count), properties:PropertyRuleSet(count)')
    .order('createdAt', { ascending: true });
  if (error) throw error;
  type RawRow = RuleSetSummary & { policies: { count: number }[]; properties: { count: number }[] };
  return ((data ?? []) as RawRow[]).map((r) => ({
    ...r,
    _count: {
      policies: r.policies[0]?.count ?? 0,
      properties: r.properties[0]?.count ?? 0,
    },
  }));
}

export async function fetchRuleSet(id: string): Promise<RuleSetDetail> {
  const [{ data: rs, error: rsErr }, { data: policies, error: polErr }, { data: links, error: linkErr }] =
    await Promise.all([
      supabase.from('RuleSet').select('*').eq('id', id).single(),
      supabase.from('RuleSetPolicy').select('*').eq('ruleSetId', id).order('name'),
      supabase.from('PropertyRuleSet').select('propertyId, property:Property(externalId)').eq('ruleSetId', id),
    ]);
  if (rsErr) throw rsErr;
  if (polErr) throw polErr;
  if (linkErr) throw linkErr;
  type LinkRow = { propertyId: string; property: { externalId: string }[] };
  return {
    ...(rs as RuleSetDetail),
    policies: (policies ?? []) as RuleSetDetail['policies'],
    linkedPropertyIds: (links ?? []).map((l) => {
      const row = l as unknown as LinkRow;
      return row.property[0]?.externalId ?? row.propertyId;
    }),
  };
}
