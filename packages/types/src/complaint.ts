export type ComplaintStatus = 'open' | 'acknowledged' | 'resolved';

export interface Complaint {
  id: string;
  ownerId: string;
  tenantId: string;
  summary: string;
  content: string;
  status: ComplaintStatus;
  createdAt: string;
}
