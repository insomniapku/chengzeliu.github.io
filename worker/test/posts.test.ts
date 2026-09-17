import assert from "node:assert/strict";
import test from "node:test";
import { PostService } from "../src/posts";
import type { GitHubCommitResult, GitHubFile, GitHubStoredFile, GitHubStorage } from "../src/types";

class FakeGitHub implements GitHubStorage {
  files = new Map<string, { content: string; sha: string }>();
  lastPut: { path: string; sha?: string; message: string } | null = null;
  lastDelete: { path: string; sha: string; message: string } | null = null;

  async listFiles(directory: string): Promise<GitHubFile[]> {
    return [...this.files.entries()].map(([path, value]) => ({
      name: path.slice(directory.length + 1), path, sha: value.sha, type: "file", size: value.content.length,
    }));
  }
  async getFile(path: string): Promise<GitHubStoredFile> {
    const value = this.files.get(path);
    if (!value) throw new Error("missing fake file");
    return { path, ...value };
  }
  async putFile(path: string, content: string, message: string, sha?: string): Promise<GitHubCommitResult> {
    this.lastPut = { path, sha, message };
    this.files.set(path, { content, sha: "new-file-sha" });
    return { sha: "commit-sha", url: "https://github.test/commit" };
  }
  async deleteFile(path: string, sha: string, message: string): Promise<GitHubCommitResult> {
    this.lastDelete = { path, sha, message };
    this.files.delete(path);
    return { sha: "delete-commit", url: "https://github.test/delete" };
  }
}

const input = {
  title: "Hello",
  slug: "hello",
  description: "A post",
  cover: "",
  content: "# Hello",
  date: "2026-09-17",
};

test("post creation writes a dated Markdown file", async () => {
  const github = new FakeGitHub();
  const service = new PostService(github, "_posts");
  const result = await service.create(input, "2026-09-17");
  assert.equal(result.path, "_posts/2026-09-17-hello.md");
  assert.equal(github.lastPut?.message, "Publish post: Hello");
  assert.equal(github.lastPut?.sha, undefined);
});

test("post update and deletion use the file current SHA", async () => {
  const github = new FakeGitHub();
  const service = new PostService(github, "_posts");
  await service.create(input, "2026-09-17");
  await service.update("hello", { ...input, content: "Updated" });
  assert.equal(github.lastPut?.sha, "new-file-sha");
  assert.equal(github.lastPut?.message, "Update post: Hello");

  await service.delete("hello");
  assert.equal(github.lastDelete?.sha, "new-file-sha");
  assert.equal(github.lastDelete?.message, "Delete post: Hello");
});

