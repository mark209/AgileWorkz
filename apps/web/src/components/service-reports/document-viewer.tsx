"use client";

// Renders the original uploaded Service Report inline — an <img> for a
// photographed report (the overwhelming majority of real AgileWorks
// uploads, per the Phase 5 production validation), an <iframe> for a PDF.
// Read-only: this component never has any way to mutate the document, only
// display the signed URL the verification API already scoped and expires.
export function DocumentViewer({ url, mimeType, fileName }: { url: string; mimeType: string; fileName: string }) {
  if (mimeType === "application/pdf") {
    return (
      <iframe
        src={url}
        title={fileName}
        className="h-full w-full rounded-md border bg-muted"
        style={{ minHeight: "70vh" }}
      />
    );
  }

  return (
    <div className="flex h-full w-full items-start justify-center overflow-auto rounded-md border bg-muted p-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- external signed storage URL, not a local/optimizable asset */}
      <img src={url} alt={fileName} className="max-w-full" />
    </div>
  );
}
