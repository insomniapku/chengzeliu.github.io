import assert from "node:assert/strict";
import test from "node:test";
import { GitHubClient } from "../src/github";
import { testEnv } from "./helpers";

test("GitHub create request uses Contents API, branch and base64 content", async () => {
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  const fakeFetch: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedInit = init;
    return Response.json({ commit: { sha: "commit-sha", html_url: "https://github.test/commit" } });
  };
  const github = new GitHubClient(testEnv(), fakeFetch);
  const result = await github.putFile("_posts/2026-09-17-hello.md", "hello", "Publish post: Hello");

  assert.equal(requestedUrl, "https://api.github.com/repos/owner/repo/contents/_posts/2026-09-17-hello.md");
  assert.equal(requestedInit?.method, "PUT");
  const body = JSON.parse(String(requestedInit?.body)) as Record<string, string>;
  assert.equal(body.branch, "main");
  assert.equal(Buffer.from(body.content!, "base64").toString("utf8"), "hello");
  assert.equal(body.sha, undefined);
  assert.equal(result.sha, "commit-sha");
});

test("GitHub update and delete requests include the current file SHA", async () => {
  const bodies: Array<Record<string, string>> = [];
  const methods: string[] = [];
  const fakeFetch: typeof fetch = async (_input, init) => {
    methods.push(init?.method ?? "GET");
    bodies.push(JSON.parse(String(init?.body)) as Record<string, string>);
    return Response.json({ commit: { sha: "next-sha", html_url: "https://github.test/commit" } });
  };
  const github = new GitHubClient(testEnv(), fakeFetch);
  await github.putFile("_posts/a.md", "updated", "Update post", "current-sha");
  await github.deleteFile("_posts/a.md", "next-sha", "Delete post");

  assert.deepEqual(methods, ["PUT", "DELETE"]);
  assert.equal(bodies[0]?.sha, "current-sha");
  assert.equal(bodies[1]?.sha, "next-sha");
});

