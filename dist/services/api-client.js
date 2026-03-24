/**
 * Shared HTTP client for the PDF Merger API.
 *
 * Uses axios for JSON endpoints and raw HTTP for multipart uploads.
 */
import axios from "axios";
import FormData from "form-data";
import fs from "node:fs";
import path from "node:path";
import { API_BASE_URL } from "../constants.js";
/* ------------------------------------------------------------------ */
/*  Generic helpers                                                    */
/* ------------------------------------------------------------------ */
/** Build a full URL for a given API path. */
function url(apiPath) {
    return `${API_BASE_URL}${apiPath.startsWith("/") ? "" : "/"}${apiPath}`;
}
/** Convert an axios / generic error into an actionable message. */
export function handleApiError(error) {
    if (axios.isAxiosError(error)) {
        const axErr = error;
        if (axErr.response) {
            const body = axErr.response.data;
            const detail = typeof body === "object" && body?.error ? body.error : "";
            switch (axErr.response.status) {
                case 400:
                    return `Error (400 Bad Request): ${detail || "Invalid request parameters."}`;
                case 404:
                    return `Error (404 Not Found): ${detail || "Resource not found. Check IDs."}`;
                case 413:
                    return `Error (413 Payload Too Large): ${detail || "File exceeds 100 MB limit."}`;
                case 415:
                    return `Error (415 Unsupported Media Type): ${detail || "Only PDF files are accepted."}`;
                case 422:
                    return `Error (422 Unprocessable Entity): ${detail || "PDF may be encrypted or corrupt."}`;
                case 502:
                    return `Error (502 Bad Gateway): ${detail || "Storage service unavailable. Retry later."}`;
                default:
                    return `Error (${axErr.response.status}): ${detail || axErr.message}`;
            }
        }
        if (axErr.code === "ECONNREFUSED") {
            return `Error: Cannot reach the PDF Merger API at ${API_BASE_URL}. Is it running?`;
        }
        if (axErr.code === "ECONNABORTED") {
            return "Error: Request timed out. Try again or use a smaller file.";
        }
    }
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
}
/* ------------------------------------------------------------------ */
/*  API methods                                                        */
/* ------------------------------------------------------------------ */
/**
 * Upload one or more PDF files.
 *
 * @param filePaths  Absolute paths to PDF files on disk.
 * @param sessionId  Optional existing session to append to.
 */
export async function uploadPdfs(filePaths, sessionId) {
    const form = new FormData();
    for (const fp of filePaths) {
        const resolved = path.resolve(fp);
        if (!fs.existsSync(resolved)) {
            throw new Error(`File not found: ${resolved}`);
        }
        form.append("pdfs", fs.createReadStream(resolved), {
            filename: path.basename(resolved),
            contentType: "application/pdf",
        });
    }
    const headers = {
        ...form.getHeaders(),
    };
    if (sessionId) {
        headers["x-session-id"] = sessionId;
    }
    const res = await axios.post(url("/upload"), form, {
        headers,
        timeout: 120_000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
    });
    return res.data;
}
/**
 * Remove a single file from a session.
 */
export async function deleteFile(sessionId, fileId) {
    const res = await axios.delete(url(`/file/${sessionId}/${fileId}`), { timeout: 30_000 });
    return res.data;
}
/**
 * Merge PDFs in the given order.
 *
 * @param sessionId  The upload session ID.
 * @param fileOrder  Ordered array of file IDs to merge.
 */
export async function mergePdfs(sessionId, fileOrder) {
    const res = await axios.post(url("/merge"), { sessionId, fileOrder }, {
        headers: { "Content-Type": "application/json" },
        timeout: 120_000,
    });
    return res.data;
}
/**
 * Build the one-time download URL for a merge token.
 */
export function downloadUrl(token) {
    return url(`/download/${token}`);
}
//# sourceMappingURL=api-client.js.map