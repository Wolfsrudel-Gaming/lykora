import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Passwort-Hash im Format scrypt$N$r$p$salt$hash (Base64). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 32, PARAMS);
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64"), hash.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: PARAMS.maxmem,
  });
  return timingSafeEqual(expected, actual);
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Ohne leicht verwechselbare Zeichen (0/O, 1/I/L).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function newCode(length: number): string {
  let code = "";
  for (let i = 0; i < length; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** Armband-ID ohne Trennzeichen in Großbuchstaben, z. B. "04A1B2C3D4E5F6". */
export function normalizeTagId(uid: string): string {
  return uid.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
}

/**
 * Hash einer Armband-ID, gebunden an das Event. Die App rechnet genauso:
 * sha256("lykora:<eventId>:<ID>") als Hex. Rohe IDs verlassen das Handy nicht.
 */
export function tagHash(eventId: string, uid: string): string {
  return createHash("sha256").update(`lykora:${eventId}:${normalizeTagId(uid)}`).digest("hex");
}
