import { beforeEach, describe, expect, it, mock } from 'bun:test';

const counters = new Map<string, number>();
const notifications: Array<{ ownerId: string; eventType: string; payload: unknown }> = [];

mock.module('@/db/redis', () => ({
  redis: {
    incr: async (key: string) => {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    },
    expire: async () => 1,
    del: async (key: string) => {
      counters.delete(key);
      return 1;
    },
  },
}));

mock.module('@/db/client', () => ({
  prisma: {
    lead: {
      findUnique: async () => ({
        name: 'Victor Martins',
        phone: '5527997300401@s.whatsapp.net',
        ownerId: 'owner-1',
      }),
    },
  },
}));

mock.module('@/services/notify', () => ({
  notifyOwner: async (ownerId: string, eventType: string, payload: unknown) => {
    notifications.push({ ownerId, eventType, payload });
  },
}));

import { recordMediaFailure } from '@/services/media-failure-tracker';

describe('recordMediaFailure', () => {
  beforeEach(() => {
    counters.clear();
    notifications.length = 0;
  });

  it('não notifica na primeira falha', async () => {
    await recordMediaFailure('5527997300401@s.whatsapp.net');
    expect(notifications.length).toBe(0);
  });

  it('notifica o owner na 2ª falha seguida, sem pausar o bot', async () => {
    await recordMediaFailure('5527997300401@s.whatsapp.net');
    await recordMediaFailure('5527997300401@s.whatsapp.net');

    expect(notifications.length).toBe(1);
    expect(notifications[0].ownerId).toBe('owner-1');
    expect(notifications[0].eventType).toBe('media_receive_failure');
    expect(notifications[0].payload).toMatchObject({
      leadName: 'Victor Martins',
      failureCount: 2,
    });
  });

  it('reseta o contador após notificar — a 3ª falha isolada não notifica de novo', async () => {
    await recordMediaFailure('5527997300401@s.whatsapp.net');
    await recordMediaFailure('5527997300401@s.whatsapp.net');
    await recordMediaFailure('5527997300401@s.whatsapp.net');

    expect(notifications.length).toBe(1);
  });
});
