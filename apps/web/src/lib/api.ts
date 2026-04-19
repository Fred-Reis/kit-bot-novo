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

export const adminApi = {
  approveKyc: (leadId: string) => botApi.post(`/admin/leads/${leadId}/approve-kyc`),
  generateContract: (leadId: string, paymentDayOfMonth: number) =>
    botApi.post(`/admin/leads/${leadId}/generate-contract`, { paymentDayOfMonth }),
  confirmPayment: (leadId: string) => botApi.post(`/admin/leads/${leadId}/confirm-payment`),
  invalidatePropertyCache: (propertyId: string) =>
    botApi.put(`/admin/properties/${propertyId}/invalidate-cache`),
};
