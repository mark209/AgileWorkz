/**
 * Phase 7 P0 — magic-byte (file-signature) verification, closing the gap
 * where upload validation trusted only the client-supplied `Content-Type`
 * header. Deliberately a small, self-contained, dependency-free check
 * rather than pulling in a general-purpose file-type-sniffing package:
 * this app's upload allowlist is fixed and narrow (exactly four formats,
 * shared by both Service Report and customer-document uploads), and all
 * four have simple, well-documented, unambiguous byte signatures — a
 * general sniffer would be more surface area (its own dependency-
 * vulnerability exposure, ESM/CJS interop) for no real benefit over four
 * plain byte comparisons.
 *
 * This never expands what's accepted — it only narrows the existing
 * ALLOWED_UPLOAD_MIME_TYPES allowlist further, by also requiring the
 * file's actual bytes to match what the client claimed. A caller must
 * still pass a mimetype this function recognizes; an unrecognized
 * mimetype is treated as a signature mismatch (fail closed), not silently
 * accepted.
 */

const PDF_SIGNATURE = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP_RIFF = Buffer.from([0x52, 0x49, 0x46, 0x46]); // "RIFF" at offset 0
const WEBP_MARKER = Buffer.from([0x57, 0x45, 0x42, 0x50]); // "WEBP" at offset 8

function startsWith(buffer: Buffer, signature: Buffer): boolean {
  return buffer.length >= signature.length && buffer.subarray(0, signature.length).equals(signature);
}

function isWebp(buffer: Buffer): boolean {
  return (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).equals(WEBP_RIFF) &&
    buffer.subarray(8, 12).equals(WEBP_MARKER)
  );
}

/**
 * Returns true only if `buffer`'s actual leading bytes match the file
 * signature expected for `mimetype`. Any mimetype not in this app's
 * upload allowlist returns false (fail closed) rather than throwing —
 * the caller is expected to have already checked the allowlist
 * separately (see ALLOWED_UPLOAD_MIME_TYPES) and only calls this for a
 * mimetype it already recognizes.
 */
export function matchesFileSignature(buffer: Buffer, mimetype: string): boolean {
  switch (mimetype) {
    case "application/pdf":
      return startsWith(buffer, PDF_SIGNATURE);
    case "image/jpeg":
      return startsWith(buffer, JPEG_SIGNATURE);
    case "image/png":
      return startsWith(buffer, PNG_SIGNATURE);
    case "image/webp":
      return isWebp(buffer);
    default:
      return false;
  }
}
