export type LeadStage =
  | 'interest'
  | 'visiting'
  | 'collection'
  | 'data_confirmation'
  | 'review_submitted'
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

// Single source of truth for valid document classifications — the bot's OCR
// classifier and the admin panel's manual-reclassify dropdown both type their
// label maps against this union, so an app-specific map missing (or adding)
// a value fails to compile instead of drifting silently out of sync.
export type LeadDocumentType =
  | 'cnh_front'
  | 'cnh_back'
  | 'cnh_full'
  | 'rg_front'
  | 'rg_back'
  | 'cpf'
  | 'income_proof'
  | 'unknown';

export interface LeadDocument {
  id: string;
  ownerId: string;
  leadId: string;
  type: string;
  classifiedBy: string;
  url: string;
  ocrText: string | null;
  createdAt: string;
}
