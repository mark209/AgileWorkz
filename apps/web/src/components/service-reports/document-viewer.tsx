"use client";

// Renders the original uploaded Service Report inline — an <img> for a
// photographed report (the overwhelming majority of real AgileWorks
// uploads, per the Phase 5 production validation), an <iframe> for a PDF.
// Read-only: this component never has any way to mutate the document, only
// display the signed URL the verification API already scoped and expires.
export function DocumentViewer({ url, mimeType, fileName }: { url: string; mimeType: string; fileName: string }) {
  if (mimeType === "application/pdf") {
    return (
      <div className="space-y-3">
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary underline">
          Open original PDF in a new tab
        </a>
        <p className="text-xs text-muted-foreground">If the preview below is blank, open the original PDF in a new tab or refresh the document link.</p>
        <iframe
          src={url}
          title={fileName}
          className="h-[65vh] min-h-80 w-full rounded-lg border bg-muted lg:h-[70vh]"
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary underline underline-offset-2">Open original image in a new tab</a>
      <div className="flex max-h-[75vh] min-h-64 w-full items-start justify-center overflow-auto rounded-lg border bg-muted p-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- external signed storage URL, not a local/optimizable asset */}
      <img src={url} alt={fileName} className="h-auto max-w-full" />
      </div>
    </div>
  );
}
