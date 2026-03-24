/**
 * TypeScript interfaces for the PDF Merger MCP Server.
 */

/** A single file entry returned by the PDF Merger API. */
export interface PdfFileEntry {
  id: string;
  name: string;
  size: number;
  sizeFormatted: string;
}

/** Response from POST /upload. */
export interface UploadResponse {
  success: boolean;
  sessionId?: string;
  files?: PdfFileEntry[];
  error?: string;
}

/** Response from POST /merge. */
export interface MergeResponse {
  success: boolean;
  token?: string;
  pageCount?: number;
  sizeFormatted?: string;
  error?: string;
}

/** Response from DELETE /file/:sessionId/:fileId. */
export interface DeleteFileResponse {
  success: boolean;
  error?: string;
}
