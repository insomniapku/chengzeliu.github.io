import type { Env } from "../src/types";

export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    BLOG_IMAGES: {} as R2Bucket,
    GITHUB_TOKEN: "test-token",
    GITHUB_OWNER: "owner",
    GITHUB_REPO: "repo",
    GITHUB_BRANCH: "main",
    POSTS_DIRECTORY: "_posts",
    ADMIN_PASSWORD_HASH: "invalid-unless-test-overrides",
    SESSION_SECRET: "this-is-a-test-session-secret-at-least-32-characters",
    PUBLIC_IMAGE_BASE_URL: "https://img.example.com",
    ALLOWED_ORIGINS: "https://chengzeliu.com",
    ENVIRONMENT: "production",
    ...overrides,
  };
}

