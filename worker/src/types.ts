export interface RateLimiterBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  BLOG_IMAGES: R2Bucket;
  LOGIN_RATE_LIMITER?: RateLimiterBinding;
  WRITE_RATE_LIMITER?: RateLimiterBinding;
  GITHUB_TOKEN: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  POSTS_DIRECTORY: string;
  ADMIN_PASSWORD_HASH: string;
  SESSION_SECRET: string;
  PUBLIC_IMAGE_BASE_URL: string;
  ALLOWED_ORIGINS: string;
  ENVIRONMENT: string;
}

export interface PostInput {
  title: string;
  slug: string;
  description?: string;
  location?: string;
  cover?: string;
  content: string;
  date?: string;
}

export interface StoredPost extends Required<Pick<PostInput, "title" | "slug" | "content">> {
  description: string;
  location: string;
  cover: string;
  date: string;
  path: string;
  sha: string;
  frontMatter: Record<string, unknown>;
}

export interface GitHubFile {
  name: string;
  path: string;
  sha: string;
  type: "file" | "dir";
  size: number;
}

export interface GitHubStoredFile {
  path: string;
  sha: string;
  content: string;
}

export interface GitHubCommitResult {
  sha: string;
  url: string;
}

export interface GitHubStorage {
  listFiles(directory: string): Promise<GitHubFile[]>;
  getFile(path: string): Promise<GitHubStoredFile>;
  putFile(path: string, content: string, message: string, sha?: string): Promise<GitHubCommitResult>;
  deleteFile(path: string, sha: string, message: string): Promise<GitHubCommitResult>;
}
