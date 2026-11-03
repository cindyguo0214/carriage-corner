// 記憶體 token bucket。多節點時改存 Redis（docs/PRD.md §7.9 的 rl:{sid}:{action}）

interface Bucket { tokens: number; updatedAt: number }

export class Limiter {
  private buckets = new Map<string, Bucket>();

  /** 在 windowMs 內最多 limit 次；成功回傳 true 並扣一次 */
  take(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
    const refill = limit / windowMs;
    const b = this.buckets.get(key) ?? { tokens: limit, updatedAt: now };
    b.tokens = Math.min(limit, b.tokens + (now - b.updatedAt) * refill);
    b.updatedAt = now;
    if (b.tokens < 1) {
      this.buckets.set(key, b);
      return false;
    }
    b.tokens -= 1;
    this.buckets.set(key, b);
    return true;
  }

  /** 清掉已經回滿的桶，避免記憶體無限成長 */
  sweep(now = Date.now()) {
    for (const [key, b] of this.buckets) if (now - b.updatedAt > 30 * 60_000) this.buckets.delete(key);
  }
}
