import type {
  GitHubCommitResult,
  GitHubFile,
  GitHubStorage,
  PostInput,
  StoredPost,
} from "./types";
import { ApiError } from "./utils";

export const MAX_MARKDOWN_BYTES = 512 * 1024;
const MAX_TITLE_LENGTH = 180;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_LOCATION_LENGTH = 120;
const MAX_SLUG_LENGTH = 100;

export function sanitizeSlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-$/g, "");
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith('"') || trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

export function parseFrontMatter(markdown: string): {
  attributes: Record<string, unknown>;
  content: string;
} {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
  if (!match) {
    throw new ApiError(500, "INVALID_POST_FORMAT", "A post has invalid or missing front matter.");
  }

  const attributes: Record<string, unknown> = {};
  for (const line of match[1]!.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator < 1) {
      throw new ApiError(500, "INVALID_POST_FORMAT", "A post contains unsupported front matter.");
    }
    attributes[line.slice(0, separator).trim()] = parseScalar(line.slice(separator + 1));
  }

  return { attributes, content: match[2]!.replace(/^\n+/, "") };
}

function serializeScalar(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  return JSON.stringify(value);
}

export function buildMarkdown(
  input: Required<Pick<PostInput, "title" | "slug" | "content" | "date">> &
    Pick<PostInput, "description" | "location" | "cover">,
  existing: Record<string, unknown> = {},
): string {
  const attributes: Record<string, unknown> = {
    ...existing,
    layout: typeof existing.layout === "string" ? existing.layout : "post",
    title: input.title,
    date: input.date,
    slug: input.slug,
    description: input.description ?? "",
  };
  if (input.location) attributes.location = input.location;
  else delete attributes.location;
  if (input.cover) attributes.cover = input.cover;
  else delete attributes.cover;

  const preferredOrder = ["layout", "title", "date", "slug", "description", "location", "cover"];
  const keys = [
    ...preferredOrder.filter((key) => key in attributes),
    ...Object.keys(attributes).filter((key) => !preferredOrder.includes(key)).sort(),
  ];
  const frontMatter = keys.map((key) => `${key}: ${serializeScalar(attributes[key])}`).join("\n");
  return `---\n${frontMatter}\n---\n\n${input.content.replace(/^\n+/, "").replace(/\s+$/, "")}\n`;
}

export function validatePostInput(value: unknown, defaultDate: string, existingSlug = ""): Required<PostInput> {
  if (!value || typeof value !== "object") {
    throw new ApiError(400, "INVALID_POST", "Post data is required.");
  }
  const raw = value as Partial<PostInput>;
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  const location = typeof raw.location === "string" ? raw.location.trim() : "";
  const cover = typeof raw.cover === "string" ? raw.cover.trim() : "";
  const content = typeof raw.content === "string" ? raw.content : "";
  const date = typeof raw.date === "string" && raw.date ? raw.date : defaultDate;
  const requestedSlug = typeof raw.slug === "string" ? raw.slug.trim() : "";
  const slug = requestedSlug
    ? sanitizeSlug(requestedSlug)
    : existingSlug || sanitizeSlug(title) || `post-${date.replace(/-/g, "")}-${crypto.randomUUID().slice(0, 6)}`;

  if (!title || title.length > MAX_TITLE_LENGTH) {
    throw new ApiError(400, "INVALID_TITLE", `Title is required and must be at most ${MAX_TITLE_LENGTH} characters.`);
  }
  if (requestedSlug && !slug) {
    throw new ApiError(400, "INVALID_SLUG", "Slug must contain letters, numbers, or hyphens.");
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new ApiError(400, "INVALID_DESCRIPTION", `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`);
  }
  if (location.length > MAX_LOCATION_LENGTH) {
    throw new ApiError(400, "INVALID_LOCATION", `Location must be at most ${MAX_LOCATION_LENGTH} characters.`);
  }
  if (!isValidDate(date)) {
    throw new ApiError(400, "INVALID_DATE", "Date must use YYYY-MM-DD and be a real date.");
  }
  if (new TextEncoder().encode(content).byteLength > MAX_MARKDOWN_BYTES) {
    throw new ApiError(413, "MARKDOWN_TOO_LARGE", "Markdown content exceeds the 512 KiB limit.");
  }
  if (cover) {
    let url: URL;
    try {
      url = new URL(cover);
    } catch {
      throw new ApiError(400, "INVALID_COVER_URL", "Cover image must be a valid URL.");
    }
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
      throw new ApiError(400, "INVALID_COVER_URL", "Cover image must use HTTPS.");
    }
  }

  return { title, slug, description, location, cover, content, date };
}

function slugFromFilename(name: string): string | null {
  return name.match(/^\d{4}-\d{2}-\d{2}-(.+)\.(?:md|markdown)$/i)?.[1] ?? null;
}

function stringAttribute(attributes: Record<string, unknown>, key: string): string {
  const value = attributes[key];
  return typeof value === "string" ? value : "";
}

export class PostService {
  constructor(
    private readonly github: GitHubStorage,
    private readonly postsDirectory: string,
  ) {}

  private async files(): Promise<GitHubFile[]> {
    const files = await this.github.listFiles(this.postsDirectory);
    return files.filter((file) => file.type === "file" && /\.(?:md|markdown)$/i.test(file.name));
  }

  private async parseFile(file: GitHubFile): Promise<StoredPost> {
    const stored = await this.github.getFile(file.path);
    const parsed = parseFrontMatter(stored.content);
    const filenameSlug = slugFromFilename(file.name) ?? "";
    return {
      title: stringAttribute(parsed.attributes, "title") || filenameSlug,
      slug: stringAttribute(parsed.attributes, "slug") || filenameSlug,
      description: stringAttribute(parsed.attributes, "description"),
      location: stringAttribute(parsed.attributes, "location"),
      cover: stringAttribute(parsed.attributes, "cover"),
      date: stringAttribute(parsed.attributes, "date") || file.name.slice(0, 10),
      content: parsed.content,
      path: file.path,
      sha: stored.sha,
      frontMatter: parsed.attributes,
    };
  }

  private async find(slugValue: string): Promise<StoredPost> {
    const slug = sanitizeSlug(slugValue);
    if (!slug) throw new ApiError(400, "INVALID_SLUG", "The post slug is invalid.");
    const files = await this.files();
    const direct = files.find((file) => slugFromFilename(file.name) === slug);
    if (direct) return this.parseFile(direct);

    for (const file of files) {
      const post = await this.parseFile(file);
      if (post.slug === slug) return post;
    }
    throw new ApiError(404, "POST_NOT_FOUND", "The requested post was not found.");
  }

  async list(): Promise<Omit<StoredPost, "content" | "frontMatter">[]> {
    const posts = await Promise.all((await this.files()).map((file) => this.parseFile(file)));
    return posts
      .sort((left, right) => right.date.localeCompare(left.date))
      .map(({ frontMatter: _frontMatter, content: _content, ...summary }) => summary);
  }

  get(slug: string): Promise<StoredPost> {
    return this.find(slug);
  }

  async create(value: unknown, today = new Date().toISOString().slice(0, 10)): Promise<GitHubCommitResult & { path: string; slug: string }> {
    const input = validatePostInput(value, today);
    const exists = (await this.files()).some((file) => slugFromFilename(file.name) === input.slug);
    if (exists) throw new ApiError(409, "POST_EXISTS", "A post with this slug already exists.");

    const path = `${this.postsDirectory}/${input.date}-${input.slug}.md`;
    const result = await this.github.putFile(path, buildMarkdown(input), `Publish post: ${input.title}`);
    return { ...result, path, slug: input.slug };
  }

  async update(slug: string, value: unknown): Promise<GitHubCommitResult & { path: string }> {
    const current = await this.find(slug);
    const input = validatePostInput(value, current.date, current.slug);
    if (input.slug !== current.slug) {
      throw new ApiError(409, "SLUG_IMMUTABLE", "The slug cannot be changed after publication. Create a new post instead.");
    }

    const markdown = buildMarkdown(input, current.frontMatter);
    const result = await this.github.putFile(
      current.path,
      markdown,
      `Update post: ${input.title}`,
      current.sha,
    );
    return { ...result, path: current.path };
  }

  async delete(slug: string): Promise<GitHubCommitResult & { path: string }> {
    const current = await this.find(slug);
    const result = await this.github.deleteFile(
      current.path,
      current.sha,
      `Delete post: ${current.title}`,
    );
    return { ...result, path: current.path };
  }
}
