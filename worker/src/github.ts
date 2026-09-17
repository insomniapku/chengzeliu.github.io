import type { Env, GitHubCommitResult, GitHubFile, GitHubStoredFile, GitHubStorage } from "./types";
import { ApiError, base64ToBytes, bytesToBase64, requiredConfig } from "./utils";

type Fetcher = typeof fetch;

interface GitHubContentResponse {
  path: string;
  sha: string;
  encoding: string;
  content: string;
}

interface GitHubMutationResponse {
  commit?: {
    sha?: string;
    html_url?: string;
  };
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export class GitHubClient implements GitHubStorage {
  private readonly apiBase: string;
  private readonly fetcher: Fetcher;

  constructor(
    private readonly env: Env,
    fetcher?: Fetcher,
  ) {
    // Cloudflare's native fetch requires the global receiver. Wrapping it in an
    // arrow function prevents an illegal invocation when called as a class field.
    this.fetcher = fetcher ?? ((input, init) => globalThis.fetch(input, init));
    const owner = encodeURIComponent(requiredConfig(env.GITHUB_OWNER, "GITHUB_OWNER"));
    const repository = encodeURIComponent(requiredConfig(env.GITHUB_REPO, "GITHUB_REPO"));
    this.apiBase = `https://api.github.com/repos/${owner}/${repository}`;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = requiredConfig(this.env.GITHUB_TOKEN, "GITHUB_TOKEN");
    let response: Response;
    try {
      response = await this.fetcher(`${this.apiBase}${path}`, {
        ...init,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "chengzeliu-blog-worker",
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...init?.headers,
        },
      });
    } catch (error) {
      console.error("GitHub fetch failed", error);
      throw new ApiError(502, "GITHUB_UNAVAILABLE", "GitHub could not be reached.");
    }

    if (!response.ok) {
      const status = response.status === 404 ? 404 : response.status === 409 || response.status === 422 ? 409 : 502;
      const code = response.status === 404 ? "POST_NOT_FOUND" : status === 409 ? "GITHUB_CONFLICT" : "GITHUB_API_ERROR";
      throw new ApiError(status, code, status === 409
        ? "The repository changed while this post was being edited. Reload and try again."
        : response.status === 404
          ? "The requested repository file was not found."
          : "GitHub rejected the repository request.");
    }

    return (await response.json()) as T;
  }

  async listFiles(directory: string): Promise<GitHubFile[]> {
    const ref = encodeURIComponent(requiredConfig(this.env.GITHUB_BRANCH, "GITHUB_BRANCH"));
    const result = await this.request<GitHubFile[] | GitHubFile>(
      `/contents/${encodePath(directory)}?ref=${ref}`,
    );
    if (!Array.isArray(result)) {
      throw new ApiError(500, "POSTS_DIRECTORY_INVALID", "The configured posts path is not a directory.");
    }
    return result;
  }

  async getFile(path: string): Promise<GitHubStoredFile> {
    const ref = encodeURIComponent(requiredConfig(this.env.GITHUB_BRANCH, "GITHUB_BRANCH"));
    const result = await this.request<GitHubContentResponse>(`/contents/${encodePath(path)}?ref=${ref}`);
    if (result.encoding !== "base64" || !result.content) {
      throw new ApiError(502, "GITHUB_API_ERROR", "GitHub returned an unsupported file response.");
    }
    return {
      path: result.path,
      sha: result.sha,
      content: new TextDecoder().decode(base64ToBytes(result.content)),
    };
  }

  async putFile(path: string, content: string, message: string, sha?: string): Promise<GitHubCommitResult> {
    const body: Record<string, string> = {
      message,
      content: bytesToBase64(new TextEncoder().encode(content)),
      branch: requiredConfig(this.env.GITHUB_BRANCH, "GITHUB_BRANCH"),
    };
    if (sha) body.sha = sha;

    const result = await this.request<GitHubMutationResponse>(`/contents/${encodePath(path)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    if (!result.commit?.sha) {
      throw new ApiError(502, "GITHUB_API_ERROR", "GitHub did not return a commit for this change.");
    }
    return { sha: result.commit.sha, url: result.commit.html_url ?? "" };
  }

  async deleteFile(path: string, sha: string, message: string): Promise<GitHubCommitResult> {
    const result = await this.request<GitHubMutationResponse>(`/contents/${encodePath(path)}`, {
      method: "DELETE",
      body: JSON.stringify({
        message,
        sha,
        branch: requiredConfig(this.env.GITHUB_BRANCH, "GITHUB_BRANCH"),
      }),
    });
    if (!result.commit?.sha) {
      throw new ApiError(502, "GITHUB_API_ERROR", "GitHub did not return a commit for this change.");
    }
    return { sha: result.commit.sha, url: result.commit.html_url ?? "" };
  }
}
