import assert from "node:assert/strict";
import test from "node:test";
import { createSessionToken, verifyPassword, verifySessionToken } from "../src/auth";
import { handleRequest } from "../src/index";
import { testEnv } from "./helpers";

async function passwordHash(password: string): Promise<string> {
  const iterations = 100000;
  const salt = new TextEncoder().encode("0123456789abcdef");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return `pbkdf2-sha256$${iterations}$${Buffer.from(salt).toString("base64")}$${Buffer.from(bits).toString("base64")}`;
}

test("password verification accepts the password and rejects another value", async () => {
  const hash = await passwordHash("a-correct-long-password");
  assert.equal(await verifyPassword("a-correct-long-password", hash), true);
  assert.equal(await verifyPassword("wrong-password", hash), false);
});

test("signed sessions expire and reject tampering", async () => {
  const secret = "this-session-secret-is-more-than-thirty-two-characters";
  const now = Date.UTC(2026, 8, 17);
  const token = await createSessionToken(secret, now);
  assert.equal(await verifySessionToken(token, secret, now + 1000), true);
  assert.equal(await verifySessionToken(`${token}x`, secret, now + 1000), false);
  assert.equal(await verifySessionToken(token, secret, now + 9 * 60 * 60 * 1000), false);
});

test("login sets a secure HttpOnly cookie that authenticates later requests", async () => {
  const hash = await passwordHash("a-correct-long-password");
  const env = testEnv({ ADMIN_PASSWORD_HASH: hash });
  const login = await handleRequest(
    new Request("https://api.chengzeliu.com/api/auth/login", {
      method: "POST",
      headers: { Origin: "https://chengzeliu.com", "Content-Type": "application/json" },
      body: JSON.stringify({ password: "a-correct-long-password" }),
    }),
    env,
  );
  assert.equal(login.status, 200);
  const setCookie = login.headers.get("Set-Cookie") ?? "";
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Strict/);

  const cookie = setCookie.split(";")[0]!;
  const me = await handleRequest(
    new Request("https://api.chengzeliu.com/api/auth/me", {
      headers: { Origin: "https://chengzeliu.com", Cookie: cookie },
    }),
    env,
  );
  assert.equal(me.status, 200);
});

test("unauthenticated post access returns 401", async () => {
  const response = await handleRequest(
    new Request("https://api.chengzeliu.com/api/posts", {
      headers: { Origin: "https://chengzeliu.com" },
    }),
    testEnv(),
  );
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://chengzeliu.com");
});

test("health endpoint is public", async () => {
  const response = await handleRequest(
    new Request("https://api.chengzeliu.com/api/health"),
    testEnv(),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("mutating requests reject an untrusted origin before authentication", async () => {
  const response = await handleRequest(
    new Request("https://api.chengzeliu.com/api/posts", {
      method: "POST",
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
      body: "{}",
    }),
    testEnv(),
  );
  assert.equal(response.status, 403);
  const body = await response.json() as { error: { code: string } };
  assert.equal(body.error.code, "ORIGIN_NOT_ALLOWED");
  assert.equal(response.headers.has("Access-Control-Allow-Origin"), false);
});
