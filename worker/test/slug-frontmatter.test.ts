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
      cover: "https://img.example.com/a.png",
      content: "# Hello\n\nBody",
      date: "2026-09-17",
    },
    { layout: "post", tags: ["robotics", "notes"] },
  );
  const parsed = parseFrontMatter(markdown);
  assert.equal(parsed.attributes.title, "A title");
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

