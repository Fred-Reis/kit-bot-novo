export type LeadStage =
  | 'interest'
  | 'collection'
  | 'review_submitted'
  | 'visiting'
  | 'kyc_pending'
  | 'kyc_approved'
  | 'residents_docs_complete'
  | 'contract_pending'
  | 'contract_signed'
  | 'converted';

export type LeadSource =
  | 'whatsapp' // criação inicial pelo bot
  | 'olx'
  | 'zap'
  | 'site'
  | 'instagram'
  | 'indicacao'
  | 'outro'
  | 'desconhecido'
  | 'other'; // legado

export interface Lead {
  id: string;
  ownerId: string;
  externalId: string | null;
  phone: string;
  name: string | null;
  source: LeadSource | null;
  propertyId: string | null;
  propertyExternalId: string | null;
  stage: LeadStage;
  contractUrl: string | null;
  autentiqueDocId: string | null;
  visitedAt: string | null;
  docsSentAt: string | null;
  contractSignedAt: string | null;
  archivedAt: string | null;
  reactivatedAt: string | null;
  scheduledVisitAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  chatId: string;
  ownerId: string;
  botPaused: boolean;
  updatedAt: string;
}

export interface LeadDocument {
  id: string;
  ownerId: string;
  leadId: string;
  type: string;
  url: string;
  ocrText: string | null;
  createdAt: string;
}
