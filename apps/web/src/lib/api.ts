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
};
