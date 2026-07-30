export const SERVICE_CATEGORIES = ['eletrica', 'hidraulica', 'civil', 'limpeza_conservacao'] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];
