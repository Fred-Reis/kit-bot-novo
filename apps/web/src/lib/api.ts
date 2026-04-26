import axios from 'axios';
import { supabase } from './supabase';

const botApi = axios.create({
  baseURL: import.meta.env.VITE_BOT_API_URL as string,
  headers: { 'Content-Type': 'application/json' },
});

// Attach Supabase JWT on every request so bot can verify identity
botApi.interceptors.request.use(async (config) => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401, refresh session and retry once
botApi.interceptors.response.use(undefined, async (error: unknown) => {
  if (!axios.isAxiosError(error) || error.response?.status !== 401 || error.config == null) {
    return Promise.reject(error);
  }
  const { data } = await supabase.auth.refreshSession();
  const token = data.session?.access_token;
  if (!token) return Promise.reject(error);
  error.config.headers.Authorization = `Bearer ${token}`;
  return botApi.request(error.config);
});

export const adminApi = {
  approveKyc: (leadId: string) => botApi.post(`/admin/leads/${leadId}/approve-kyc`),
  generateContract: (leadId: string, paymentDayOfMonth: number) =>
    botApi.post(`/admin/leads/${leadId}/generate-contract`, { paymentDayOfMonth }),
  confirmPayment: (leadId: string) => botApi.post(`/admin/leads/${leadId}/confirm-payment`),
  invalidatePropertyCache: (propertyId: string) =>
    botApi.put(`/admin/properties/${propertyId}/invalidate-cache`),
  createProperty: (data: Record<string, unknown>) => botApi.post('/admin/properties', data),
  updateProperty: (id: string, data: Record<string, unknown>) =>
    botApi.patch(`/admin/properties/${id}`, data),
  deleteProperty: (id: string) => botApi.delete(`/admin/properties/${id}`),
  deletePropertyMedia: (propertyId: string, mediaId: string) =>
    botApi.delete(`/admin/properties/${propertyId}/media/${mediaId}`),
  createTenant: (data: Record<string, unknown>) => botApi.post('/admin/tenants', data),
  getPropertyMediaSignedUrl: (propertyId: string, data: { fileName: string; contentType: string }) =>
    botApi.post(`/admin/properties/${propertyId}/media/signed-url`, data),
  createPropertyMedia: (propertyId: string, data: { path: string; type: string; label?: string }) =>
    botApi.post(`/admin/properties/${propertyId}/media`, data),
  createRuleSet: (data: { name: string; description?: string }) =>
    botApi.post('/admin/rule-sets', data),
  updateRuleSet: (id: string, data: Record<string, unknown>) =>
    botApi.patch(`/admin/rule-sets/${id}`, data),
  deleteRuleSet: (id: string) =>
    botApi.delete(`/admin/rule-sets/${id}`),
  createPolicy: (ruleSetId: string, data: { name: string; description?: string; value?: string; appliesToProperty?: boolean }) =>
    botApi.post(`/admin/rule-sets/${ruleSetId}/policies`, data),
  updatePolicy: (ruleSetId: string, policyId: string, data: { value?: string; appliesToProperty?: boolean }) =>
    botApi.patch(`/admin/rule-sets/${ruleSetId}/policies/${policyId}`, data),
  deletePolicy: (ruleSetId: string, policyId: string) =>
    botApi.delete(`/admin/rule-sets/${ruleSetId}/policies/${policyId}`),
  createContractTemplate: (name: string) =>
    botApi.post('/admin/contract-templates', { name }),
  updateContractTemplate: (id: string, data: { name?: string; body?: string; status?: string }) =>
    botApi.patch(`/admin/contract-templates/${id}`, data),
  deleteContractTemplate: (id: string) =>
    botApi.delete(`/admin/contract-templates/${id}`),
};
