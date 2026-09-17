import {
  clearSessionCookie,
  createSessionToken,
  isAuthenticated,
  requireAuthentication,
  sessionCookie,
  verifyPassword,
} from "./auth";
import { GitHubClient } from "./github";
import { deleteImage, uploadImage } from "./images";
import { PostService } from "./posts";
import type { Env } from "./types";
import {
  addCors,
  ApiError,
  enforceRateLimit,
  errorResponse,
  getClientIp,
  isAllowedOrigin,
  json,
  ok,
  readJson,
  requireAllowedOrigin,
  requiredConfig,
} from "./utils";

function routeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new ApiError(400, "INVALID_PATH", "The request path is invalid.");
  }
}

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") {
    if (!isAllowedOrigin(request.headers.get("Origin"), env)) {
      throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "This request origin is not allowed.");
    }
    return new Response(null, { status: 204 });
  }

  if (method === "GET" && path === "/api/health") {
    return json({ ok: true });
  }

  if (["POST", "PUT", "DELETE"].includes(method)) {
    requireAllowedOrigin(request, env);
  }

  if (method === "POST" && path === "/api/auth/login") {
    await enforceRateLimit(env.LOGIN_RATE_LIMITER, `login:${getClientIp(request)}`);
    const body = await readJson<{ password?: unknown }>(request, 4096);
    if (typeof body.password !== "string" || body.password.length < 1 || body.password.length > 1024) {
      throw new ApiError(400, "INVALID_CREDENTIALS", "Enter the administrator password.");
    }
    const valid = await verifyPassword(
      body.password,
      requiredConfig(env.ADMIN_PASSWORD_HASH, "ADMIN_PASSWORD_HASH"),
    );
    if (!valid) throw new ApiError(401, "INVALID_CREDENTIALS", "The password is incorrect.");

    const token = await createSessionToken(env.SESSION_SECRET);
    return json(
      { ok: true, data: { authenticated: true } },
      200,
      { "Set-Cookie": sessionCookie(token, env) },
    );
  }

  if (method === "POST" && path === "/api/auth/logout") {
    return json(
      { ok: true, data: { authenticated: false } },
      200,
      { "Set-Cookie": clearSessionCookie(env) },
    );
  }

  if (method === "GET" && path === "/api/auth/me") {
    if (!(await isAuthenticated(request, env))) {
      throw new ApiError(401, "UNAUTHORIZED", "Please sign in to continue.");
    }
    return ok({ authenticated: true });
  }

  await requireAuthentication(request, env);
  const posts = new PostService(new GitHubClient(env), requiredConfig(env.POSTS_DIRECTORY, "POSTS_DIRECTORY"));

  if (["POST", "PUT", "DELETE"].includes(method)) {
    await enforceRateLimit(env.WRITE_RATE_LIMITER, `write:${getClientIp(request)}`);
  }

  if (method === "GET" && path === "/api/posts") return ok(await posts.list());
  if (method === "POST" && path === "/api/posts") {
    return ok(await posts.create(await readJson(request)), 201);
  }

  const postMatch = path.match(/^\/api\/posts\/([^/]+)$/);
  if (postMatch) {
    const slug = routeSegment(postMatch[1]!);
    if (method === "GET") return ok(await posts.get(slug));
    if (method === "PUT") return ok(await posts.update(slug, await readJson(request)));
    if (method === "DELETE") return ok(await posts.delete(slug));
  }

  if (method === "POST" && path === "/api/images") return ok(await uploadImage(request, env), 201);
  const imageMatch = path.match(/^\/api\/images\/(.+)$/);
  if (method === "DELETE" && imageMatch) {
    await deleteImage(imageMatch[1]!, env);
    return ok({ deleted: true });
  }

  throw new ApiError(404, "NOT_FOUND", "The requested API endpoint does not exist.");
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  let response: Response;
  try {
    response = await route(request, env);
  } catch (error) {
    response = errorResponse(error);
  }
  return withSecurityHeaders(addCors(response, request, env));
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
