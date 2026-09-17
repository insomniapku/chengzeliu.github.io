import assert from "node:assert/strict";
import test from "node:test";
import { buildMarkdown, parseFrontMatter, sanitizeSlug, validatePostInput } from "../src/posts";

test("sanitizeSlug removes path characters and normalizes text", () => {
  assert.equal(sanitizeSlug("  My ../ First_Post!!  "), "my-first-post");
  assert.equal(sanitizeSlug("../../"), "");
  assert.equal(sanitizeSlug("Café Notes"), "cafe-notes");
});

test("front matter generation round-trips and preserves extra fields", () => {
  const markdown = buildMarkdown(
    {
      title: "A title",
      slug: "a-title",
      description: "A description",
      location: "Beijing Haidian",
      cover: "https://img.example.com/a.png",
      content: "# Hello\n\nBody",
      date: "2026-09-17",
    },
    { layout: "post", tags: ["robotics", "notes"] },
  );
  const parsed = parseFrontMatter(markdown);
  assert.equal(parsed.attributes.title, "A title");
  assert.equal(parsed.attributes.location, "Beijing Haidian");
  assert.deepEqual(parsed.attributes.tags, ["robotics", "notes"]);
  assert.equal(parsed.content, "# Hello\n\nBody\n");
});

test("post validation enforces date and slug", () => {
  assert.throws(
    () => validatePostInput({ title: "Bad", slug: "../", content: "" }, "2026-09-17"),
    /Slug must contain/,
  );
  assert.throws(
    () => validatePostInput({ title: "Bad", slug: "bad", content: "", date: "2026-02-30" }, "2026-09-17"),
    /real date/,
  );
});

test("post validation generates a slug when the optional field is empty", () => {
  assert.equal(
    validatePostInput({ title: "My First Post", slug: "", content: "" }, "2026-09-17").slug,
    "my-first-post",
  );
  assert.match(
    validatePostInput({ title: "中文标题", content: "" }, "2026-09-17").slug,
    /^post-20260917-[a-f0-9]{6}$/,
  );
});
