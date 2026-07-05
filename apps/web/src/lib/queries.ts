import type {
  ContractDetail,
  ContractSummary,
  ContractTemplate,
  ContractTemplateSummary,
  Conversation,
  Lead,
  LeadDocument,
  LeadStage,
  Payment,
  Property,
  PropertyMedia,
  RuleSetDetail,
  RuleSetSummary,
  Tenant,
} from '@kit-manager/types';
import { supabase } from './supabase';
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
    .is('archivedAt', null)
    .order('updatedAt', { ascending: false })
    .limit(100);
  if (error) throw error;
  return ((data ?? []) as LeadRow[]).map(mapLeadRow);
}

export async function fetchLead(
  id: string,
): Promise<Lead & { botPaused: boolean; documents: LeadDocument[] }> {
  const [{ data: lead, error: leadErr }, { data: docs, error: docsErr }] = await Promise.all([
    supabase.from('Lead').select('*, property:Property(externalId)').eq('id', id).single(),
    supabase
      .from('LeadDocument')
      .select('*')
      .eq('leadId', id)
      .order('createdAt', { ascending: true }),
  ]);
  if (leadErr) throw leadErr;
  if (docsErr) throw docsErr;

  const mappedLead = mapLeadRow(lead as LeadRow);

  // Conversation has no leadId FK — must join on phone after lead resolves
  const { data: conv } = await supabase
    .from('Conversation')
    .select('botPaused')
    .eq('chatId', mappedLead.phone)
    .maybeSingle();

  return {
    ...mappedLead,
    botPaused: (conv as Pick<Conversation, 'botPaused'> | null)?.botPaused ?? false,
    documents: (docs as LeadDocument[]) ?? [],
  };
}

export async function fetchProperties(): Promise<Property[]> {
  const [{ data: props, error: propsErr }, { data: media, error: mediaErr }] = await Promise.all([
    supabase
      .from('Property')
      .select('*')
      .neq('status', 'archived')
      .order('createdAt', { ascending: true }),
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
  actorLabel: string | null;
  action: string;
  subject: string | null;
  subjectType: string | null;
  createdAt: string;
}

export async function fetchActivityLog(limit = 10): Promise<ActivityLogEntry[]> {
  const { data, error } = await supabase
    .from('ActivityLog')
    .select('id, actorLabel, action, subject, subjectType, createdAt')
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
  const [
    { data: rs, error: rsErr },
    { data: policies, error: polErr },
    { data: links, error: linkErr },
  ] = await Promise.all([
    supabase.from('RuleSet').select('*').eq('id', id).single(),
    supabase.from('RuleSetPolicy').select('*').eq('ruleSetId', id).order('name'),
    supabase
      .from('PropertyRuleSet')
      .select('propertyId, property:Property(externalId)')
      .eq('ruleSetId', id),
  ]);
  if (rsErr) throw rsErr;
  if (polErr) throw polErr;
  if (linkErr) throw linkErr;
  type LinkRow = { propertyId: string; property: { externalId: string }[] };
  return {
    ...(rs as RuleSetDetail),
    policies: (policies ?? []) as RuleSetDetail['policies'],
    linkedProperties: (links ?? []).map((l) => {
      const row = l as unknown as LinkRow;
      return {
        propertyId: row.propertyId,
        externalId: row.property[0]?.externalId ?? row.propertyId,
      };
    }),
  };
}

export async function fetchContractTemplates(): Promise<ContractTemplateSummary[]> {
  const { data, error } = await supabase
    .from('ContractTemplate')
    .select('id, code, name, status, updatedAt, contracts:Contract(count)')
    .order('updatedAt', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((t) => {
    const { contracts, ...rest } = t as typeof t & { contracts: { count: number }[] };
    return { ...rest, usageCount: contracts[0]?.count ?? 0 };
  }) as ContractTemplateSummary[];
}

export async function fetchContractTemplate(id: string): Promise<ContractTemplate> {
  const { data, error } = await supabase.from('ContractTemplate').select('*').eq('id', id).single();
  if (error) throw error;
  return data as ContractTemplate;
}

type ContractRow = Omit<ContractSummary, 'tenant' | 'property'> & {
  tenant: { name: string | null }[];
  property: { name: string }[];
};

export async function fetchContracts(): Promise<ContractSummary[]> {
  const { data, error } = await supabase
    .from('Contract')
    .select(
      'id, code, status, startDate, endDate, monthlyRent, tenant:Tenant(name), property:Property(name)',
    )
    .order('createdAt', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as ContractRow[]).map((r) => ({
    ...r,
    tenant: { name: r.tenant[0]?.name ?? null },
    property: { name: r.property[0]?.name ?? '' },
  }));
}

type ContractDetailRow = Omit<ContractDetail, 'tenant' | 'property'> & {
  tenant: { name: string | null; phone: string }[];
  property: { name: string }[];
};

export async function fetchContract(id: string): Promise<ContractDetail> {
  const { data, error } = await supabase
    .from('Contract')
    .select('*, tenant:Tenant(name, phone), property:Property(name)')
    .eq('id', id)
    .single();
  if (error) throw error;
  const r = data as unknown as ContractDetailRow;
  return {
    ...r,
    tenant: { name: r.tenant[0]?.name ?? null, phone: r.tenant[0]?.phone ?? '' },
    property: { name: r.property[0]?.name ?? '' },
  };
}

export async function fetchPublishedTemplates(): Promise<ContractTemplateSummary[]> {
  const { data, error } = await supabase
    .from('ContractTemplate')
    .select('id, code, name, status, updatedAt')
    .eq('status', 'published')
    .order('updatedAt', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((t) => ({ ...t, usageCount: 0 })) as ContractTemplateSummary[];
}

export async function fetchPropertyActivityLog(propertyId: string): Promise<ActivityLogEntry[]> {
  const { data, error } = await supabase
    .from('ActivityLog')
    .select('id, actorLabel, action, subject, subjectType, createdAt')
    .eq('subjectId', propertyId)
    .order('createdAt', { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []) as ActivityLogEntry[];
}

export interface PropertyTenantSummary {
  id: string;
  name: string | null;
  phone: string;
  onTimeRate: number | null;
  dueDay: number | null;
}

export async function fetchPropertyTenant(
  propertyId: string,
): Promise<PropertyTenantSummary | null> {
  const { data, error } = await supabase
    .from('Tenant')
    .select('id, name, phone, onTimeRate, dueDay')
    .eq('propertyId', propertyId)
    .maybeSingle();
  if (error) throw error;
  return data as PropertyTenantSummary | null;
}

export interface PropertyContractSummary {
  id: string;
  code: string;
  endDate: string | null;
  monthlyRent: number;
  tenantName: string | null;
}

type PropertyContractRow = {
  id: string;
  code: string;
  endDate: string | null;
  monthlyRent: number;
  tenant: { name: string | null }[];
};

export async function fetchPropertyContract(
  propertyId: string,
): Promise<PropertyContractSummary | null> {
  const { data, error } = await supabase
    .from('Contract')
    .select('id, code, endDate, monthlyRent, tenant:Tenant(name)')
    .eq('propertyId', propertyId)
    .eq('status', 'active')
    .order('createdAt', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as PropertyContractRow;
  return {
    id: row.id,
    code: row.code,
    endDate: row.endDate,
    monthlyRent: row.monthlyRent,
    tenantName: row.tenant[0]?.name ?? null,
  };
}

export async function fetchPropertyPayments(propertyId: string): Promise<Payment[]> {
  const { data, error } = await supabase
    .from('Payment')
    .select('*')
    .eq('propertyId', propertyId)
    .order('month', { ascending: false })
    .limit(12);
  if (error) throw error;
  return (data ?? []) as Payment[];
}

export interface PropertyLeadSummary {
  id: string;
  name: string | null;
  phone: string;
  stage: LeadStage;
}

export async function fetchPropertyLeads(propertyId: string): Promise<PropertyLeadSummary[]> {
  const { data, error } = await supabase
    .from('Lead')
    .select('id, name, phone, stage')
    .eq('propertyId', propertyId)
    .neq('stage', 'converted')
    .order('updatedAt', { ascending: false });
  if (error) throw error;
  return (data ?? []) as PropertyLeadSummary[];
}

export interface VisitEntry {
  id: string;
  externalId: string | null;
  name: string | null;
  phone: string;
  stage: LeadStage;
  scheduledVisitAt: string | null;
  visitedAt: string | null;
  archivedAt: string | null;
  propertyId: string | null;
  property: { externalId: string | null; address: string; neighborhood: string } | null;
}

export async function fetchVisits(): Promise<VisitEntry[]> {
  const { data, error } = await supabase
    .from('Lead')
    .select(
      'id, externalId, name, phone, stage, scheduledVisitAt, visitedAt, archivedAt, propertyId, property:propertyId(externalId, address, neighborhood)',
    )
    .not('scheduledVisitAt', 'is', null)
    .order('scheduledVisitAt', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as unknown as VisitEntry[];
}

export interface OwnerSettings {
  id: string;
  botEnabled: boolean;
  notificationPhone: string | null;
  notificationEmail: string | null;
}

export async function fetchOwner(): Promise<OwnerSettings> {
  const { data, error } = await supabase
    .from('Owner')
    .select('id, botEnabled, notificationPhone, notificationEmail')
    .single();
  if (error) throw error;
  return data as OwnerSettings;
}
