import type { Env } from "./types";
import { ApiError, requiredConfig } from "./utils";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "image/png";
  if (
    bytes.length >= 12 &&
    new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP"
  ) return "image/webp";
  if (bytes.length >= 6) {
    const signature = new TextDecoder().decode(bytes.subarray(0, 6));
    if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
  }
  return null;
}

export function validateImage(bytes: Uint8Array, declaredMime: string): { mime: string; extension: string } {
  if (bytes.byteLength === 0) throw new ApiError(400, "EMPTY_IMAGE", "Choose a non-empty image file.");
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new ApiError(413, "IMAGE_TOO_LARGE", "Image exceeds the 8 MiB limit.");
  }
  const normalizedDeclared = declaredMime.toLowerCase().split(";")[0]!.trim();
  if (!(normalizedDeclared in MIME_EXTENSIONS)) {
    throw new ApiError(415, "UNSUPPORTED_IMAGE_TYPE", "Only JPEG, PNG, WebP, and GIF images are supported.");
  }
  const detected = sniffImageMime(bytes);
  if (!detected || detected !== normalizedDeclared) {
    throw new ApiError(415, "IMAGE_TYPE_MISMATCH", "The image contents do not match its declared type.");
  }
  return { mime: detected, extension: MIME_EXTENSIONS[detected]! };
}

function imageKey(extension: string, now = new Date()): string {
  const [year, month, day] = now.toISOString().slice(0, 10).split("-");
  return `blog/${year}/${month}/${day}/${crypto.randomUUID()}.${extension}`;
}

export async function uploadImage(request: Request, env: Env): Promise<{ key: string; url: string }> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Image uploads must use multipart/form-data.");
  }

  const declaredLength = Number(request.headers.get("Content-Length") ?? 0);
  if (declaredLength > MAX_IMAGE_BYTES + 1024 * 1024) {
    throw new ApiError(413, "IMAGE_TOO_LARGE", "Image exceeds the 8 MiB limit.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ApiError(400, "INVALID_UPLOAD", "The upload form could not be read.");
  }
  const value = form.get("file");
  if (!(value instanceof File)) throw new ApiError(400, "IMAGE_REQUIRED", "Choose an image to upload.");

  const bytes = new Uint8Array(await value.arrayBuffer());
  const validated = validateImage(bytes, value.type);
  const key = imageKey(validated.extension);
  try {
    await env.BLOG_IMAGES.put(key, bytes, { httpMetadata: { contentType: validated.mime } });
  } catch {
    throw new ApiError(502, "R2_UPLOAD_ERROR", "The image could not be stored. Please try again.");
  }
  const base = requiredConfig(env.PUBLIC_IMAGE_BASE_URL, "PUBLIC_IMAGE_BASE_URL").replace(/\/+$/, "");
  return { key, url: `${base}/${key}` };
}

export async function deleteImage(rawKey: string, env: Env): Promise<void> {
  let key: string;
  try {
    key = decodeURIComponent(rawKey);
  } catch {
    throw new ApiError(400, "INVALID_IMAGE_KEY", "The image key is invalid.");
  }
  if (!/^blog\/\d{4}\/\d{2}\/\d{2}\/[a-f0-9-]+\.(?:jpg|png|webp|gif)$/i.test(key)) {
    throw new ApiError(400, "INVALID_IMAGE_KEY", "The image key is invalid.");
  }
  try {
    await env.BLOG_IMAGES.delete(key);
  } catch {
    throw new ApiError(502, "R2_DELETE_ERROR", "The image could not be deleted. Please try again.");
  }
}

