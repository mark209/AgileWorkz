"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Upload } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  DOCUMENT_TYPE_LABEL,
  type CustomerDocument,
  type DocumentRelatedType,
  type DocumentType,
  getDocumentSignedUrl,
  listDocuments,
} from "@/lib/api";
import { uploadFileWithProgress, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";

// Approved V1 upload policy (matches apps/api/src/modules/documents/documents.service.ts
// exactly) — enforced here for UX only; the backend remains authoritative.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const ALLOWED_MIME_LABEL = "PDF, JPEG, PNG, or WebP";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentPanel({ relatedType, relatedId }: { relatedType: DocumentRelatedType; relatedId: string }) {
  const { accessToken, hasPermission } = useAuth();
  const canRead = hasPermission("customer_documents", "read");
  const canUpload = hasPermission("customer_documents", "upload");

  const [documents, setDocuments] = useState<CustomerDocument[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState<DocumentType>("OTHER");
  const [isDragging, setIsDragging] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDocuments = useCallback(async () => {
    if (!accessToken || !canRead) return;
    setListError(null);
    try {
      const rows = await listDocuments(accessToken, relatedType, relatedId);
      setDocuments(rows);
    } catch (e) {
      setListError(e instanceof ApiError ? e.message : "Failed to load documents.");
    }
  }, [accessToken, canRead, relatedType, relatedId]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  function validateFile(file: File): string | null {
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return `Unsupported file type "${file.type || "unknown"}". Allowed: ${ALLOWED_MIME_LABEL}.`;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return `File is too large (${formatFileSize(file.size)}). Maximum size is 25 MB.`;
    }
    return null;
  }

  function pickFile(file: File | undefined) {
    if (!file) return;
    const error = validateFile(file);
    setValidationError(error);
    setSelectedFile(error ? null : file);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    pickFile(event.dataTransfer.files[0]);
  }

  async function handleUpload() {
    if (!selectedFile || !accessToken) return;
    setUploadError(null);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("relatedType", relatedType);
    formData.append("relatedId", relatedId);
    formData.append("documentType", documentType);

    try {
      const created = await uploadFileWithProgress<CustomerDocument>("/documents", accessToken, formData, setUploadProgress);
      setDocuments((prev) => (prev ? [created, ...prev] : [created]));
      setSelectedFile(null);
      setDocumentType("OTHER");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e) {
      setUploadError(e instanceof ApiError ? e.message : "Upload failed. Please try again.");
    } finally {
      setUploadProgress(null);
    }
  }

  async function handleOpen(doc: CustomerDocument) {
    if (!accessToken) return;
    try {
      const { url } = await getDocumentSignedUrl(accessToken, doc.id);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setListError(e instanceof ApiError ? e.message : "Failed to open document.");
    }
  }

  if (!canRead) return null;

  return (
    <div className="space-y-4">
      {canUpload && (
        <div className="space-y-3">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors ${
              isDragging ? "border-primary bg-accent" : "border-input"
            }`}
          >
            <Upload className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              Drag a file here, or{" "}
              <button
                type="button"
                className="font-medium text-primary underline-offset-4 hover:underline"
                onClick={() => fileInputRef.current?.click()}
              >
                browse
              </button>
            </p>
            <p className="text-xs text-muted-foreground">{ALLOWED_MIME_LABEL} — up to 25 MB</p>
            <input
              ref={fileInputRef}
              type="file"
              accept={Array.from(ALLOWED_MIME_TYPES).join(",")}
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
          </div>

          {validationError && <p className="text-sm text-destructive">{validationError}</p>}

          {selectedFile && !validationError && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{selectedFile.name}</p>
                <p className="text-xs text-muted-foreground">{formatFileSize(selectedFile.size)}</p>
              </div>
              <Select
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value as DocumentType)}
                className="w-auto"
                aria-label="Document type"
              >
                {Object.entries(DOCUMENT_TYPE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              <Button size="sm" onClick={handleUpload} disabled={uploadProgress !== null}>
                {uploadProgress !== null ? "Uploading…" : "Upload"}
              </Button>
            </div>
          )}

          {uploadProgress !== null && <Progress value={uploadProgress} />}
          {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}
        </div>
      )}

      {listError && <ErrorState message={listError} onRetry={loadDocuments} />}
      {!listError && documents === null && <LoadingState label="Loading documents…" />}
      {!listError && documents !== null && documents.length === 0 && (
        <EmptyState title="No documents yet" description="Uploaded contracts, warranties, and photos will appear here." />
      )}
      {!listError && documents !== null && documents.length > 0 && (
        <ul className="divide-y rounded-md border">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center gap-3 p-3">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{doc.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {DOCUMENT_TYPE_LABEL[doc.documentType]} · {formatFileSize(doc.fileSize)} ·{" "}
                  {new Date(doc.uploadedAt).toLocaleDateString()}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => handleOpen(doc)}>
                Open
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
