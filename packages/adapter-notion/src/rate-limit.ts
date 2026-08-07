/**
 * Simple token-bucket rate limiter for Notion's ~3 req/s average per connection.
 * All adapter API calls should acquire a token before fetch.
 */

export class TokenBucket {
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private tokens: number;
  private lastRefill: number;

  constructor(capacity: number, refillPerSecond: number) {
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    if (elapsedSec <= 0) {
      return;
    }
    this.tokens = Math.min(
      this.capacity,
      this.tokens + elapsedSec * this.refillPerSecond
    );
    this.lastRefill = now;
  }

  /** Wait until a token is available, then consume one. */
  async acquire(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const deficit = 1 - this.tokens;
      const waitMs = Math.ceil((deficit / this.refillPerSecond) * 1000);
      await sleep(Math.max(waitMs, 10));
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Default Notion connection budget: ~3 req/s with small burst. */
export function createNotionRateLimiter(): TokenBucket {
  return new TokenBucket(3, 3);
}
