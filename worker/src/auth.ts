import type { Env } from "./types";
import { ApiError, base64ToBytes, fromBase64Url, requiredConfig, toBase64Url } from "./utils";

export const SESSION_COOKIE = "blog_admin_session";
const SESSION_SECONDS = 8 * 60 * 60;
const PBKDF2_ITERATIONS = 100_000;

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const [algorithm, iterationsText, saltText, hashText, ...extra] = encodedHash.split("$");
  const iterations = Number(iterationsText);
  if (
    algorithm !== "pbkdf2-sha256" ||
    !Number.isInteger(iterations) ||
    iterations !== PBKDF2_ITERATIONS ||
    !saltText ||
    !hashText ||
    extra.length > 0
  ) {
    throw new ApiError(500, "SERVER_MISCONFIGURED", "ADMIN_PASSWORD_HASH is not valid.");
  }

  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = base64ToBytes(saltText);
    expected = base64ToBytes(hashText);
  } catch {
    throw new ApiError(500, "SERVER_MISCONFIGURED", "ADMIN_PASSWORD_HASH is not valid.");
  }

  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  let derived: ArrayBuffer;
  try {
    derived = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
      passwordKey,
      expected.byteLength * 8,
    );
  } catch {
    throw new ApiError(500, "SERVER_MISCONFIGURED", "ADMIN_PASSWORD_HASH cannot be verified by this runtime.");
  }
  return constantTimeEqual(new Uint8Array(derived), expected);
}

async function hmac(value: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

export async function createSessionToken(secret: string, now = Date.now()): Promise<string> {
  if (requiredConfig(secret, "SESSION_SECRET").length < 32) {
    throw new ApiError(500, "SERVER_MISCONFIGURED", "SESSION_SECRET must be at least 32 characters.");
  }
  const payload = {
    exp: Math.floor(now / 1000) + SESSION_SECONDS,
    nonce: crypto.randomUUID(),
  };
  const encodedPayload = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = toBase64Url(await hmac(encodedPayload, secret));
  return `${encodedPayload}.${signature}`;
}

export async function verifySessionToken(token: string, secret: string, now = Date.now()): Promise<boolean> {
  const [encodedPayload, encodedSignature, ...extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra.length > 0 || secret.length < 32) return false;

  let suppliedSignature: Uint8Array;
  let payload: { exp?: unknown };
  try {
    suppliedSignature = fromBase64Url(encodedSignature);
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload))) as { exp?: unknown };
  } catch {
    return false;
  }

  const expectedSignature = await hmac(encodedPayload, secret);
  if (!constantTimeEqual(suppliedSignature, expectedSignature)) return false;
  return typeof payload.exp === "number" && payload.exp > Math.floor(now / 1000);
}

function parseCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const pair of (header ?? "").split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
  }
  return cookies;
}

export async function isAuthenticated(request: Request, env: Env): Promise<boolean> {
  const token = parseCookies(request.headers.get("Cookie")).get(SESSION_COOKIE);
  if (!token) return false;
  return verifySessionToken(token, env.SESSION_SECRET);
}

export async function requireAuthentication(request: Request, env: Env): Promise<void> {
  if (!(await isAuthenticated(request, env))) {
    throw new ApiError(401, "UNAUTHORIZED", "Please sign in to continue.");
  }
}

export function sessionCookie(token: string, env: Env): string {
  const secure = env.ENVIRONMENT === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/api; HttpOnly${secure}; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
}

export function clearSessionCookie(env: Env): string {
  const secure = env.ENVIRONMENT === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/api; HttpOnly${secure}; SameSite=Strict; Max-Age=0`;
}
