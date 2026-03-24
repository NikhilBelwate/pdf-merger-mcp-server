/**
 * Shared HTTP client for the PDF Merger API.
 *
 * Uses axios for JSON endpoints and raw HTTP for multipart uploads.
 */
import type { UploadResponse, MergeResponse, DeleteFileResponse } from "../types.js";
/** Convert an axios / generic error into an actionable message. */
export declare function handleApiError(error: unknown): string;
/**
 * Upload one or more PDF files.
 *
 * @param filePaths  Absolute paths to PDF files on disk.
 * @param sessionId  Optional existing session to append to.
 */
export declare function uploadPdfs(filePaths: string[], sessionId?: string): Promise<UploadResponse>;
/**
 * Remove a single file from a session.
 */
export declare function deleteFile(sessionId: string, fileId: string): Promise<DeleteFileResponse>;
/**
 * Merge PDFs in the given order.
 *
 * @param sessionId  The upload session ID.
 * @param fileOrder  Ordered array of file IDs to merge.
 */
export declare function mergePdfs(sessionId: string, fileOrder: string[]): Promise<MergeResponse>;
/**
 * Build the one-time download URL for a merge token.
 */
export declare function downloadUrl(token: string): string;
//# sourceMappingURL=api-client.d.ts.map