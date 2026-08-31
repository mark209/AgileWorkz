import { Controller, ForbiddenException, Get, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { LocalDiskStorageProvider } from "./local-disk-storage.provider";
import { Public } from "../guards/public.decorator";

// Phase 5 Step 5 — completes LocalDiskStorageProvider's own
// verifySignedToken() method, which existed but had no HTTP route calling
// it (getSignedUrl previously returned a "local-storage://" URL no browser
// could ever fetch). Dev-only: this route is meaningless when
// STORAGE_PROVIDER=s3, since the S3 adapter's signed URLs point directly at
// the S3-compatible endpoint instead of back through this app. Not gated
// by PermissionsGuard/@Permissions — the signature + expiry ARE the access
// control, same model as any real signed-URL scheme (S3, GCS, etc.), and a
// verification-screen <img>/<iframe> tag has no way to attach an
// Authorization header anyway.
@Controller("storage")
export class LocalStorageController {
  constructor(private readonly localDisk: LocalDiskStorageProvider) {}

  // @Public() — bypasses JwtAuthGuard too, not just PermissionsGuard.
  // Deliberate: an <img>/<iframe> tag cannot attach an Authorization
  // header, so the signature + expiry embedded in the URL itself ARE the
  // access control here, exactly like a real S3 presigned URL needs no
  // separate bearer token either.
  // A wildcard, not @Param("key") — a storage key routinely contains real
  // "/" separators (e.g. "service-reports/<id>.jpg"), and those must stay
  // as real path segments, not a %2F encoded into one segment (Node/Express
  // decodes %2F ahead of routing, which breaks a single-segment :param
  // match entirely — see the comment on getSignedUrl's own encoding).
  @Public()
  @Get("local/*")
  async serve(@Req() req: Request, @Query("expires") expires: string, @Query("sig") sig: string, @Res() res: Response) {
    // req.path is already decoded by Express — do not decodeURIComponent
    // it again (that would double-decode any literal "%" a key happened
    // to contain).
    const key = req.path.replace(/^\/storage\/local\//, "");
    const expiresAt = Number(expires);
    // verifySignedToken uses crypto.timingSafeEqual internally, which
    // throws (rather than returning false) when the two buffers differ in
    // length — a real possibility here since sig is untrusted client
    // input, unlike every other current caller of this method. Guard it
    // so a malformed sig 403s cleanly instead of 500ing.
    let valid: boolean;
    try {
      valid = Boolean(expiresAt) && Boolean(sig) && this.localDisk.verifySignedToken(key, expiresAt, sig);
    } catch {
      valid = false;
    }
    if (!valid) {
      throw new ForbiddenException("Invalid or expired storage link");
    }
    const body = await this.localDisk.getObject(key);
    res.setHeader("Content-Type", guessContentType(key));
    res.setHeader("Cache-Control", "private, max-age=60");
    res.send(body);
  }
}

function guessContentType(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "pdf":
      return "application/pdf";
    case "jpg":
    case "jpeg":
    default:
      return "image/jpeg";
  }
}
