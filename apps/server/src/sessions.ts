// 斷線重連用的 resumeToken：HMAC 簽章的 { sid, pid, roomId, exp }（docs/PRD.md §7.6）
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface ResumeClaims {
  sid: string;
  pid: string;
  roomId: string;
  exp: number;
}

const b64 = (s: string) => Buffer.from(s).toString('base64url');

export class Sessions {
  constructor(private secret: string) {}

  issue(claims: Omit<ResumeClaims, 'exp'>, ttlMs = 24 * 3_600_000): string {
    const payload = b64(JSON.stringify({ ...claims, exp: Date.now() + ttlMs }));
    return `${payload}.${this.sign(payload)}`;
  }

  verify(token: string | null | undefined): ResumeClaims | null {
    if (!token) return null;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    const expected = Buffer.from(this.sign(payload));
    const actual = Buffer.from(sig);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as ResumeClaims;
      return claims.exp > Date.now() ? claims : null;
    } catch {
      return null;
    }
  }

  private sign(payload: string) {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }
}
