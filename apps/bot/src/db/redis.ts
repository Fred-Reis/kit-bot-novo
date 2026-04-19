import Redis from 'ioredis';
import { config } from '@/config';

const globalForRedis = global as unknown as { redis: Redis };

export const redis =
  globalForRedis.redis ??
  new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: false,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis;
}
