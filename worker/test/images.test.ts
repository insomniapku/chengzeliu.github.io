import assert from "node:assert/strict";
import test from "node:test";
import { MAX_IMAGE_BYTES, sniffImageMime, validateImage } from "../src/images";

test("image signatures are detected for supported formats", () => {
  assert.equal(sniffImageMime(Uint8Array.from([0xff, 0xd8, 0xff, 0x00])), "image/jpeg");
  assert.equal(sniffImageMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(sniffImageMime(new TextEncoder().encode("GIF89a")), "image/gif");
  assert.equal(sniffImageMime(new TextEncoder().encode("RIFFxxxxWEBP")), "image/webp");
});

test("image validation rejects MIME mismatch and oversize files", () => {
  assert.throws(
    () => validateImage(Uint8Array.from([0xff, 0xd8, 0xff]), "image/png"),
    /do not match/,
  );
  assert.throws(
    () => validateImage(new Uint8Array(MAX_IMAGE_BYTES + 1), "image/png"),
    /8 MiB/,
  );
});

