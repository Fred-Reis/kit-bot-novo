export type LeadStage =
  | 'interest'
  | 'collection'
  | 'review_submitted'
  | 'kyc_pending'
  | 'kyc_approved'
  | 'residents_docs_complete'
  | 'contract_pending'
  | 'contract_signed'
  | 'converted';

export interface Lead {
  id: string;
  phone: string;
  propertyId: string | null;
  stage: LeadStage;
  contractUrl: string | null;
  autentiqueDocId: string | null;
  visitedAt: string | null;
  docsSentAt: string | null;
  contractSignedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadDocument {
  id: string;
  leadId: string;
  type: string;
  url: string;
  ocrText: string | null;
  createdAt: string;
}
