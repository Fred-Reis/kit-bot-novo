export interface ContractTemplate {
  id: string;
  ownerId: string;
  code: string;
  name: string;
  body: string;
  status: 'draft' | 'published';
  createdAt: string;
  updatedAt: string;
}

export type ContractTemplateSummary = Omit<ContractTemplate, 'body' | 'createdAt'> & {
  usageCount: number;
};
