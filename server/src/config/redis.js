/**
 * redis.js — Redis connection + cache helpers
 *
 * Redis is entirely optional. If REDIS_URL is unset or the server is
 * unreachable, all cache reads return null and writes are silently dropped.
 * BullMQ also falls back to an in-memory queue (see analysisWorker.js).
 *
 * Exports:
 *   connectRedis()  — call once at startup
 *   getRedis()      — returns the ioredis client if connected, else null
 *   cache           — { get, set, del } helpers that swallow Redis errors
 *
 * @module config/redis
 */

const { Redis } = require('ioredis');

let redis;

const connectRedis = async () => {
  redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null, // required for BullMQ
    lazyConnect: true,
    retryStrategy: () => null, // don't retry — fail fast and stay silent
  });

  let warnedOnce = false;
  redis.on('error', () => {
    if (!warnedOnce) {
      warnedOnce = true;
      console.warn('⚠️  Redis not available — caching disabled');
    }
  });

  try {
    await redis.connect();
    console.log('✅ Redis connected');
  } catch {
    console.warn('⚠️  Running without Redis (no caching/queuing)');
  }
};

const getRedis = () => (redis?.status === 'ready' ? redis : null);

// Safe cache helpers — gracefully handle Redis being down
const cache = {
  async get(key) {
    try {
      const val = await redis.get(key);
      return val ? JSON.parse(val) : null;
    } catch { return null; }
  },
  async set(key, value, ttlSeconds = 3600) {
    try {
      await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch { /* ignore */ }
  },
  async del(key) {
    try { await redis.del(key); } catch { /* ignore */ }
  },
};

module.exports = { connectRedis, getRedis, cache };
