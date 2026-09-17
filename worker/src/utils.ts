import type { Env } from "./types";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function json(value: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

export function ok(data: unknown, status = 200): Response {
  return json({ ok: true, data }, status);
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return json({ ok: false, error: { code: error.code, message: error.message } }, error.status);
  }

  console.error("Unhandled API error", error);
  return json(
    { ok: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } },
    500,
  );
}

export function allowedOrigins(env: Env): Set<string> {
  return new Set(
    env.ALLOWED_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

export function isAllowedOrigin(origin: string | null, env: Env): boolean {
  if (!origin) return false;
  if (allowedOrigins(env).has(origin)) return true;
  if (env.ENVIRONMENT === "production") return false;

  try {
    const url = new URL(origin);
    return (
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      (url.protocol === "http:" || url.protocol === "https:")
    );
  } catch {
    return false;
  }
}

export function requireAllowedOrigin(request: Request, env: Env): void {
  if (!isAllowedOrigin(request.headers.get("Origin"), env)) {
    throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "This request origin is not allowed.");
  }
}

export function addCors(response: Response, request: Request, env: Env): Response {
  const origin = request.headers.get("Origin");
  if (!isAllowedOrigin(origin, env)) return response;

  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin!);
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Max-Age", "86400");
  headers.append("Vary", "Origin");

  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function readJson<T>(request: Request, maxBytes = 600_000): Promise<T> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Expected an application/json request.");
  }

  const declaredLength = Number(request.headers.get("Content-Length") ?? 0);
  if (declaredLength > maxBytes) {
    throw new ApiError(413, "REQUEST_TOO_LARGE", "The request body is too large.");
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new ApiError(413, "REQUEST_TOO_LARGE", "The request body is too large.");
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(400, "INVALID_JSON", "The request body is not valid JSON.");
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function toBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return base64ToBytes(padded);
}

export function getClientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

export async function enforceRateLimit(
  limiter: Env["LOGIN_RATE_LIMITER"],
  key: string,
): Promise<void> {
  if (!limiter) return;
  const result = await limiter.limit({ key });
  if (!result.success) {
    throw new ApiError(429, "RATE_LIMITED", "Too many requests. Please wait and try again.");
  }
}

export function requiredConfig(value: string | undefined, name: string): string {
  if (!value) throw new ApiError(500, "SERVER_MISCONFIGURED", `${name} is not configured.`);
  return value;
}

