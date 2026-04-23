type AttemptBucket = {
  count: number;
  windowStart: number;
  blockedUntil: number;
};

const WINDOW_MS = 10 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

const buckets = new Map<string, AttemptBucket>();

function getOrCreateBucket(key: string, now: number) {
  const existing = buckets.get(key);

  if (!existing) {
    const fresh: AttemptBucket = { count: 0, windowStart: now, blockedUntil: 0 };
    buckets.set(key, fresh);
    return fresh;
  }

  if (existing.windowStart + WINDOW_MS <= now) {
    existing.count = 0;
    existing.windowStart = now;
    existing.blockedUntil = 0;
  }

  return existing;
}

function cleanup(now: number) {
  for (const [key, bucket] of buckets) {
    const staleWindow = bucket.windowStart + WINDOW_MS + BLOCK_MS < now;
    const staleBlock = bucket.blockedUntil > 0 && bucket.blockedUntil + BLOCK_MS < now;

    if (staleWindow || staleBlock) {
      buckets.delete(key);
    }
  }
}

export function getRetryAfterSeconds(key: string, now = Date.now()) {
  cleanup(now);

  const bucket = buckets.get(key);

  if (!bucket || bucket.blockedUntil <= now) {
    return 0;
  }

  return Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1000));
}

export function registerFailedAttempt(key: string, now = Date.now()) {
  cleanup(now);

  const bucket = getOrCreateBucket(key, now);
  bucket.count += 1;

  if (bucket.count >= MAX_ATTEMPTS) {
    bucket.blockedUntil = now + BLOCK_MS;
  }

  return getRetryAfterSeconds(key, now);
}

export function clearAttempts(key: string) {
  buckets.delete(key);
}

