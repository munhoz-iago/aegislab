import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE_NAME = "aegislab_session";
export const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function readSessionToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const matches = cookieHeader.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (matches.length !== 1) return null;
  const token = matches[0]?.slice(SESSION_COOKIE_NAME.length + 1);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
