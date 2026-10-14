import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 32 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await deriveKey(password, salt);
  return `scrypt$${COST}$${BLOCK_SIZE}$${PARALLELISM}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, cost, blockSize, parallelism, saltString, hashString] = parts;
  if (cost !== String(COST) || blockSize !== String(BLOCK_SIZE) || parallelism !== String(PARALLELISM)) return false;
  if (!saltString || !hashString) return false;
  const salt = Buffer.from(saltString, "base64url");
  const expected = Buffer.from(hashString, "base64url");
  if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
  const actual = await deriveKey(password, salt);
  return timingSafeEqual(actual, expected);
}

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, KEY_LENGTH, { N: COST, r: BLOCK_SIZE, p: PARALLELISM, maxmem: MAX_MEMORY }, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
}
