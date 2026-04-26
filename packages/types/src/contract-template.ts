export interface ContractTemplate {
  id: string;
  code: string;
  name: string;
  body: string;
  status: 'draft' | 'published';
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export type ContractTemplateSummary = Omit<ContractTemplate, 'body' | 'createdAt'>;
