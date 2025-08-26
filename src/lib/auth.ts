// src/server/auth.ts
import crypto from "node:crypto";

// Custom HMAC cookie: auth_token = base64(userId).hex(hmacSHA256(base64(userId), secret))
export function verifyCustomAuthCookie(cookieValue: string | undefined): { userId: string } | null {
  if (!cookieValue) return null;
  const secret = process.env.CUSTOM_AUTH_SECRET;
  if (!secret) return null;

  const parts = cookieValue.split(".");
  if (parts.length !== 2) return null;
  const [base64UserId, signatureHex] = parts;

  let userId: string;
  try {
    const buf = Buffer.from(base64UserId, "base64url");
    userId = buf.toString("utf8");
  } catch {
    return null;
  }

  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(base64UserId);
  const expected = hmac.digest("hex");
  if (!timingSafeEqualHex(signatureHex, expected)) return null;

  return { userId };
}

function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}
