import { http, HttpResponse } from 'msw';

// Admin action mocks — removed when Phase 4 bot endpoints are live
export const handlers = [
  http.post('*/admin/leads/:id/approve-kyc', () => HttpResponse.json({ success: true })),
  http.post('*/admin/leads/:id/generate-contract', () => HttpResponse.json({ success: true })),
  http.post('*/admin/leads/:id/confirm-payment', () => HttpResponse.json({ success: true })),
  http.put('*/admin/properties/:id/invalidate-cache', () => HttpResponse.json({ success: true })),
];
