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

const getRedis = () => redis;

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
