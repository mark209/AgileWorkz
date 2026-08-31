import { matchesFileSignature } from "../src/common/file-signature.util";

// Real, minimal, valid leading bytes for each format this app accepts.
const REAL_PDF = Buffer.from("255044462d312e340a", "hex"); // "%PDF-1.4\n"
const REAL_JPEG = Buffer.from("ffd8ffe000104a46494600", "hex");
const REAL_PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const REAL_WEBP = Buffer.from("524946460000000057454250", "hex"); // "RIFF"+size+"WEBP"

describe("matchesFileSignature", () => {
  it.each([
    ["application/pdf", REAL_PDF],
    ["image/jpeg", REAL_JPEG],
    ["image/png", REAL_PNG],
    ["image/webp", REAL_WEBP],
  ])("accepts real %s bytes", (mimetype, buffer) => {
    expect(matchesFileSignature(buffer, mimetype)).toBe(true);
  });

  it.each([
    ["application/pdf", REAL_JPEG],
    ["image/jpeg", REAL_PNG],
    ["image/png", REAL_WEBP],
    ["image/webp", REAL_PDF],
  ])("rejects %s claimed over another real format's bytes (spoofed MIME type)", (claimedMimetype, actualBytes) => {
    expect(matchesFileSignature(actualBytes, claimedMimetype)).toBe(false);
  });

  it.each(["application/pdf", "image/jpeg", "image/png", "image/webp"])(
    "rejects %s claimed over plain-text garbage bytes (invalid signature)",
    (mimetype) => {
      expect(matchesFileSignature(Buffer.from("this is not a real file, just text"), mimetype)).toBe(false);
    },
  );

  it("rejects an empty buffer for every allowed type", () => {
    for (const mimetype of ["application/pdf", "image/jpeg", "image/png", "image/webp"]) {
      expect(matchesFileSignature(Buffer.alloc(0), mimetype)).toBe(false);
    }
  });

  it("rejects a buffer shorter than the expected signature, rather than throwing", () => {
    expect(matchesFileSignature(Buffer.from([0x89, 0x50]), "image/png")).toBe(false);
  });

  it("fails closed for a mimetype outside this app's allowlist, even with real-looking bytes", () => {
    expect(matchesFileSignature(REAL_JPEG, "image/gif")).toBe(false);
    expect(matchesFileSignature(REAL_PDF, "application/octet-stream")).toBe(false);
  });

  it("WEBP is verified by both the RIFF header AND the WEBP four-character code, not RIFF alone", () => {
    // A generic RIFF file that ISN'T actually WebP (e.g. a WAV audio file's header shape).
    const riffButNotWebp = Buffer.from("524946460000000057415645", "hex"); // "RIFF"+size+"WAVE"
    expect(matchesFileSignature(riffButNotWebp, "image/webp")).toBe(false);
  });
});
