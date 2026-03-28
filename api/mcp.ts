/**
 * Vercel API Route — PDF Toolkit MCP Server
 *
 * Exposes both the PDF Merger App and the PDF Splitter App as MCP tools.
 *
 * IMPORTANT — Serverless transport model:
 *   A fresh McpServer + StreamableHTTPServerTransport is created per
 *   request. This avoids the "Already connected to a transport" error
 *   that occurs when a warm Vercel instance reuses a connected singleton.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios, { AxiosError } from "axios";
import FormData from "form-data";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

// ================================================================
// Constants
// ================================================================

const MERGER_API_URL =
  process.env.PDF_MERGER_API_URL ?? "https://pdfmerger.omega-x.com";

const SPLITTER_API_URL =
  process.env.PDF_SPLITTER_API_URL ?? "https://pdfsplitter.omega-x.com";

// ================================================================
// TypeScript interfaces
// ================================================================

// -- Merger types --
interface PdfFileEntry {
  id: string;
  name: string;
  size: number;
  sizeFormatted: string;
}

interface MergerUploadResponse {
  success: boolean;
  sessionId?: string;
  files?: PdfFileEntry[];
  error?: string;
}

interface MergeResponse {
  success: boolean;
  token?: string;
  pageCount?: number;
  sizeFormatted?: string;
  error?: string;
}

interface DeleteFileResponse {
  success: boolean;
  error?: string;
}

// -- Splitter types --
interface SplitterUploadResponse {
  success: boolean;
  originalBlobUrl?: string;
  pageCount?: number;
  fileName?: string;
  fileSize?: number;
  fileSizeFormatted?: string;
  error?: string;
}

interface SplitFileEntry {
  id: string;
  name: string;
  rangeLabel: string;
  pageCount: number;
  size: number;
  sizeFormatted: string;
  blobUrl: string;
}

interface SplitResponse {
  success: boolean;
  files?: SplitFileEntry[];
  error?: string;
}

// ================================================================
// Zod Schemas — Merger
// ================================================================

const UploadPdfsInputSchema = z.object({
  file_paths: z.array(z.string().min(1)).min(1).max(30)
    .describe("Absolute local file paths — only valid for self-hosted deployments"),
  session_id: z.string().uuid().optional().describe("Existing session ID"),
});

const UploadBase64InputSchema = z.object({
  files: z.array(z.object({
    name: z.string().min(1).describe("Filename including .pdf extension (e.g. report.pdf)"),
    content: z.string().min(1).describe("Base64-encoded PDF file content"),
  })).min(1).max(30).describe("Array of PDF files encoded as base64 strings"),
  session_id: z.string().uuid().optional().describe("Optional existing session ID to append files to"),
});

const RemoveFileInputSchema = z.object({
  session_id: z.string().uuid().describe("Session ID"),
  file_id: z.string().uuid().describe("File ID to remove"),
});

const MergePdfsInputSchema = z.object({
  session_id: z.string().uuid().describe("Session ID"),
  file_order: z.array(z.string().uuid()).min(2).max(30)
    .describe("Ordered list of file IDs — first entry = first pages in output"),
});

const GetMergerDownloadUrlInputSchema = z.object({
  token: z.string().uuid().describe("One-time download token from merge"),
});

// ================================================================
// Zod Schemas — Splitter
// ================================================================

const SplitterUploadBase64Schema = z.object({
  name: z.string().min(1).describe("Filename including .pdf extension"),
  content: z.string().min(1).describe("Base64-encoded PDF content (must have ≥2 pages)"),
});

const SplitterSplitSchema = z.object({
  original_blob_url: z.string().url().describe("The originalBlobUrl returned from pdf_splitter_upload"),
  original_file_name: z.string().optional().describe("Original filename — used to derive split filenames"),
  ranges: z.array(z.object({
    start: z.number().int().min(1).describe("Start page (1-indexed, inclusive)"),
    end: z.number().int().min(1).describe("End page (1-indexed, inclusive)"),
  })).min(1).describe("Page ranges to split. Example: [{start:1,end:5},{start:6,end:10}]"),
});

const SplitterDownloadSchema = z.object({
  blob_url: z.string().url().describe("Blob URL of the split PDF file"),
  filename: z.string().optional().describe("Desired download filename (default: split.pdf)"),
  file_id: z.string().optional().describe("File ID (used in download path, can be any string)"),
});

const SplitterDownloadAllSchema = z.object({
  files: z.array(z.object({
    blobUrl: z.string().url().describe("Blob URL of split PDF"),
    name: z.string().min(1).describe("Filename inside the ZIP"),
  })).min(1).describe("Array of split files to include in the ZIP"),
  original_blob_url: z.string().url().optional().describe("Original PDF blob URL (deleted after ZIP)"),
  zip_name: z.string().optional().describe("Base name for ZIP file (default: split-pdfs)"),
});

const SplitterClearSchema = z.object({
  blob_urls: z.array(z.string().url()).describe("Array of blob URLs to delete"),
});

// ================================================================
// Shared helpers
// ================================================================

function mergerUrl(p: string): string {
  return `${MERGER_API_URL}${p.startsWith("/") ? "" : "/"}${p}`;
}

function splitterUrl(p: string): string {
  return `${SPLITTER_API_URL}${p.startsWith("/") ? "" : "/"}${p}`;
}

function handleApiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const axErr = error as AxiosError<{ error?: string; success?: boolean }>;
    if (axErr.response) {
      const body = axErr.response.data;
      const detail = typeof body === "object" && body?.error ? body.error : "";
      switch (axErr.response.status) {
        case 400: return `Error (400): ${detail || "Invalid parameters."}`;
        case 404: return `Error (404): ${detail || "Resource not found."}`;
        case 413: return `Error (413): ${detail || "File exceeds 100 MB."}`;
        case 415: return `Error (415): ${detail || "Only PDFs accepted."}`;
        case 422: return `Error (422): ${detail || "PDF may be encrypted or corrupt."}`;
        case 502: return `Error (502): ${detail || "Storage unavailable."}`;
        case 503: return `Error (503): ${detail || "Service not configured."}`;
        default:  return `Error (${axErr.response.status}): ${detail || axErr.message}`;
      }
    }
  }
  return `Error: ${error instanceof Error ? error.message : String(error)}`;
}

/** Decode base64 → validate PDF magic bytes → write to /tmp. Returns tmp path. */
async function base64ToTmpFile(name: string, content: string): Promise<string> {
  const buffer = Buffer.from(content, "base64");
  if (
    buffer.length < 4 ||
    buffer[0] !== 0x25 || buffer[1] !== 0x50 ||
    buffer[2] !== 0x44 || buffer[3] !== 0x46
  ) {
    throw new Error(`"${name}" is not a valid PDF (bad magic bytes).`);
  }
  const safeName = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_");
  const tmpPath = `/tmp/${randomUUID()}_${safeName}`;
  await fsp.writeFile(tmpPath, buffer);
  return tmpPath;
}

/** Clean up temp files (fire-and-forget). */
function cleanupTmp(paths: string[]): void {
  for (const p of paths) {
    fsp.unlink(p).catch(() => {});
  }
}

// ================================================================
// Merger API helpers
// ================================================================

async function mergerUploadPdfs(
  filePaths: string[],
  sessionId?: string
): Promise<MergerUploadResponse> {
  const form = new FormData();
  for (const fp of filePaths) {
    const resolved = path.resolve(fp);
    if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
    form.append("pdfs", fs.createReadStream(resolved), {
      filename: path.basename(resolved),
      contentType: "application/pdf",
    });
  }
  const headers: Record<string, string> = { ...form.getHeaders() };
  if (sessionId) headers["x-session-id"] = sessionId;
  const res = await axios.post<MergerUploadResponse>(mergerUrl("/upload"), form, {
    headers, timeout: 120_000, maxContentLength: Infinity, maxBodyLength: Infinity,
  });
  return res.data;
}

async function mergerDeleteFile(sessionId: string, fileId: string): Promise<DeleteFileResponse> {
  const res = await axios.delete<DeleteFileResponse>(mergerUrl(`/file/${sessionId}/${fileId}`), { timeout: 30_000 });
  return res.data;
}

async function mergerMergePdfs(sessionId: string, fileOrder: string[]): Promise<MergeResponse> {
  const res = await axios.post<MergeResponse>(
    mergerUrl("/merge"), { sessionId, fileOrder },
    { headers: { "Content-Type": "application/json" }, timeout: 120_000 }
  );
  return res.data;
}

function mergerDownloadUrl(token: string): string {
  return mergerUrl(`/download/${token}`);
}

// ================================================================
// Splitter API helpers
// ================================================================

async function splitterUploadPdf(tmpPath: string): Promise<SplitterUploadResponse> {
  const form = new FormData();
  form.append("pdf", fs.createReadStream(tmpPath), {
    filename: path.basename(tmpPath),
    contentType: "application/pdf",
  });
  const res = await axios.post<SplitterUploadResponse>(splitterUrl("/api/upload"), form, {
    headers: form.getHeaders(),
    timeout: 60_000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
  return res.data;
}

async function splitterSplit(
  originalBlobUrl: string,
  originalFileName: string | undefined,
  ranges: Array<{ start: number; end: number }>
): Promise<SplitResponse> {
  const res = await axios.post<SplitResponse>(
    splitterUrl("/api/split"),
    { originalBlobUrl, originalFileName: originalFileName ?? "document.pdf", ranges },
    { headers: { "Content-Type": "application/json" }, timeout: 120_000 }
  );
  return res.data;
}

function splitterFileDownloadUrl(fileId: string, blobUrl: string, filename: string): string {
  const encoded = encodeURIComponent(blobUrl);
  const encodedName = encodeURIComponent(filename);
  return splitterUrl(`/api/download/${fileId}?blobUrl=${encoded}&filename=${encodedName}`);
}

async function splitterDownloadAll(
  files: Array<{ blobUrl: string; name: string }>,
  originalBlobUrl?: string,
  zipName?: string
): Promise<Buffer> {
  const res = await axios.post(
    splitterUrl("/api/download-all"),
    { files, originalBlobUrl, zipName: zipName ?? "split-pdfs" },
    { headers: { "Content-Type": "application/json" }, timeout: 120_000, responseType: "arraybuffer" }
  );
  return Buffer.from(res.data);
}

async function splitterClear(blobUrls: string[]): Promise<void> {
  await axios.delete(splitterUrl("/api/clear"), {
    data: { blobUrls },
    headers: { "Content-Type": "application/json" },
    timeout: 30_000,
  });
}

// ================================================================
// MCP Server factory
// ================================================================

function buildMcpServer(): McpServer {
  const server = new McpServer({
    name: "pdf-merger-mcp-server",
    version: "2.0.0",
  });

  // ╔════════════════════════════════════════════════════════════════╗
  // ║  PDF MERGER TOOLS                                             ║
  // ╚════════════════════════════════════════════════════════════════╝

  // ── Merger Tool 1: Upload via file paths (local only) ─────────
  server.registerTool("pdf_merger_upload_pdfs", {
    title: "Upload PDFs (local paths)",
    description: `Upload PDF files by absolute filesystem path.
NOTE: Only works when the MCP server runs on the same machine as the files.
For Vercel / remote deployments use pdf_merger_upload_base64 instead.`,
    inputSchema: UploadPdfsInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (params: z.infer<typeof UploadPdfsInputSchema>) => {
    try {
      const result = await mergerUploadPdfs(params.file_paths, params.session_id);
      if (!result.success) return { isError: true, content: [{ type: "text" as const, text: `Upload failed: ${result.error}` }] };
      const output = { session_id: result.sessionId, files: result.files ?? [] };
      return { content: [{ type: "text" as const, text: `Uploaded ${output.files.length} file(s) — session: ${output.session_id}` }], structuredContent: output };
    } catch (error) { return { isError: true, content: [{ type: "text" as const, text: handleApiError(error) }] }; }
  });

  // ── Merger Tool 2: Upload via base64 ──────────────────────────
  server.registerTool("pdf_merger_upload_base64", {
    title: "Upload PDFs (base64)",
    description: `Upload PDF files as base64-encoded content. Use this tool on Vercel or any
remote deployment where the server cannot access local file paths.

Workflow:
  1. Read each PDF file and encode its bytes as a base64 string.
  2. Call this tool with the array of { name, content } objects.
  3. Use the returned session_id and file IDs with pdf_merger_merge.

Args:
  - files: array of objects, each with:
      name    – filename including .pdf extension (e.g. "report.pdf")
      content – base64-encoded bytes of the PDF file
  - session_id (optional) – append to an existing session

Returns (JSON):
  {
    "session_id": "uuid",
    "files": [{ "id": "uuid", "name": "report.pdf", "size": 102400, "sizeFormatted": "100 KB" }]
  }

Error Handling:
  - Invalid base64 content → clear decode error
  - Content is not a PDF (wrong magic bytes) → validation error
  - File >100 MB → 413 error from PDF Merger API`,
    inputSchema: UploadBase64InputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (params: z.infer<typeof UploadBase64InputSchema>) => {
    const tmpPaths: string[] = [];
    try {
      for (const file of params.files) {
        tmpPaths.push(await base64ToTmpFile(file.name, file.content));
      }
      const result = await mergerUploadPdfs(tmpPaths, params.session_id);
      if (!result.success) return { isError: true, content: [{ type: "text" as const, text: `Upload failed: ${result.error}` }] };
      const output = { session_id: result.sessionId, files: result.files ?? [] };
      const summary = output.files.map((f) => `  - ${f.name} (${f.sizeFormatted}) → id: ${f.id}`).join("\n");
      return { content: [{ type: "text" as const, text: `Uploaded ${output.files.length} file(s) to session ${output.session_id}:\n${summary}` }], structuredContent: output };
    } catch (error) { return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : handleApiError(error) }] };
    } finally { cleanupTmp(tmpPaths); }
  });

  // ── Merger Tool 3: Remove file ────────────────────────────────
  server.registerTool("pdf_merger_remove_file", {
    title: "Remove File from Session",
    description: "Permanently remove a PDF file from an upload session.",
    inputSchema: RemoveFileInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, async (params: z.infer<typeof RemoveFileInputSchema>) => {
    try {
      const result = await mergerDeleteFile(params.session_id, params.file_id);
      if (!result.success) return { isError: true, content: [{ type: "text" as const, text: `Remove failed: ${result.error}` }] };
      return { content: [{ type: "text" as const, text: `File ${params.file_id} removed.` }], structuredContent: { success: true } };
    } catch (error) { return { isError: true, content: [{ type: "text" as const, text: handleApiError(error) }] }; }
  });

  // ── Merger Tool 4: Merge ──────────────────────────────────────
  server.registerTool("pdf_merger_merge", {
    title: "Merge PDFs",
    description: "Merge uploaded PDFs in specified order. Returns a one-time download token.",
    inputSchema: MergePdfsInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (params: z.infer<typeof MergePdfsInputSchema>) => {
    try {
      const result = await mergerMergePdfs(params.session_id, params.file_order);
      if (!result.success) return { isError: true, content: [{ type: "text" as const, text: `Merge failed: ${result.error}` }] };
      const output = { token: result.token!, page_count: result.pageCount, size_formatted: result.sizeFormatted, download_url: mergerDownloadUrl(result.token!) };
      return { content: [{ type: "text" as const, text: `Merge complete: ${output.page_count} pages, ${output.size_formatted}\nDownload: ${output.download_url}` }], structuredContent: output };
    } catch (error) { return { isError: true, content: [{ type: "text" as const, text: handleApiError(error) }] }; }
  });

  // ── Merger Tool 5: Get download URL ───────────────────────────
  server.registerTool("pdf_merger_get_download_url", {
    title: "Get Merger Download URL",
    description: "Build the one-time download URL from a merge token.",
    inputSchema: GetMergerDownloadUrlInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params: z.infer<typeof GetMergerDownloadUrlInputSchema>) => {
    const urlStr = mergerDownloadUrl(params.token);
    return { content: [{ type: "text" as const, text: `Download URL: ${urlStr}` }], structuredContent: { download_url: urlStr } };
  });

  // ╔════════════════════════════════════════════════════════════════╗
  // ║  PDF SPLITTER TOOLS                                           ║
  // ╚════════════════════════════════════════════════════════════════╝

  // ── Splitter Tool 1: Upload PDF (base64) ──────────────────────
  server.registerTool("pdf_splitter_upload", {
    title: "Upload PDF for Splitting",
    description: `Upload a single PDF file (base64-encoded) to the PDF Splitter service.
The PDF must have at least 2 pages.

Returns the originalBlobUrl (needed for splitting) and page count.

Args:
  - name: Filename (e.g. "report.pdf")
  - content: Base64-encoded PDF bytes

Returns (JSON):
  {
    "original_blob_url": "https://...",
    "page_count": 45,
    "file_name": "report.pdf",
    "file_size_formatted": "2.0 MB"
  }

Error Handling:
  - Not a valid PDF → magic bytes check fails
  - PDF has <2 pages → 400 error
  - Encrypted PDF → 400 error`,
    inputSchema: SplitterUploadBase64Schema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (params: z.infer<typeof SplitterUploadBase64Schema>) => {
    let tmpPath = "";
    try {
      tmpPath = await base64ToTmpFile(params.name, params.content);
      const result = await splitterUploadPdf(tmpPath);
      if (!result.success) return { isError: true, content: [{ type: "text" as const, text: `Upload failed: ${result.error}` }] };
      const output = {
        original_blob_url: result.originalBlobUrl!,
        page_count: result.pageCount!,
        file_name: result.fileName!,
        file_size_formatted: result.fileSizeFormatted!,
      };
      return {
        content: [{ type: "text" as const, text: `Uploaded "${output.file_name}" (${output.file_size_formatted}, ${output.page_count} pages).\nUse original_blob_url with pdf_splitter_split to define page ranges.` }],
        structuredContent: output,
      };
    } catch (error) { return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : handleApiError(error) }] };
    } finally { if (tmpPath) cleanupTmp([tmpPath]); }
  });

  // ── Splitter Tool 2: Split PDF ────────────────────────────────
  server.registerTool("pdf_splitter_split", {
    title: "Split PDF by Page Ranges",
    description: `Split a previously uploaded PDF into multiple smaller PDFs by page ranges.

Args:
  - original_blob_url: URL returned from pdf_splitter_upload
  - original_file_name (optional): Used to derive filenames for split parts
  - ranges: Array of { start, end } page ranges (1-indexed, inclusive)
    Example: [{ start: 1, end: 5 }, { start: 6, end: 10 }]

Returns (JSON):
  {
    "files": [
      {
        "id": "uuid",
        "name": "report_pages_1-5.pdf",
        "range_label": "Pages 1–5",
        "page_count": 5,
        "size_formatted": "500 KB",
        "blob_url": "https://..."
      }
    ]
  }

Workflow:
  1. pdf_splitter_upload → get original_blob_url + page_count
  2. pdf_splitter_split → define ranges, get split file objects
  3. pdf_splitter_get_download_url → get URL for individual files
  4. OR pdf_splitter_download_all → get ZIP of all files`,
    inputSchema: SplitterSplitSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (params: z.infer<typeof SplitterSplitSchema>) => {
    try {
      const result = await splitterSplit(params.original_blob_url, params.original_file_name, params.ranges);
      if (!result.success) return { isError: true, content: [{ type: "text" as const, text: `Split failed: ${result.error}` }] };
      const files = (result.files ?? []).map((f) => ({
        id: f.id, name: f.name, range_label: f.rangeLabel, page_count: f.pageCount,
        size_formatted: f.sizeFormatted, blob_url: f.blobUrl,
      }));
      const summary = files.map((f) => `  - ${f.name} (${f.range_label}, ${f.size_formatted})`).join("\n");
      return {
        content: [{ type: "text" as const, text: `Split into ${files.length} file(s):\n${summary}` }],
        structuredContent: { files },
      };
    } catch (error) { return { isError: true, content: [{ type: "text" as const, text: handleApiError(error) }] }; }
  });

  // ── Splitter Tool 3: Get download URL for single split file ───
  server.registerTool("pdf_splitter_get_download_url", {
    title: "Get Splitter Download URL",
    description: `Build a download URL for a single split PDF file.

Args:
  - blob_url: The blobUrl from the split response
  - filename (optional): Desired download filename
  - file_id (optional): File ID from split response (default: "file")

Returns (JSON):
  { "download_url": "https://pdfsplitter.omega-x.com/api/download/..." }`,
    inputSchema: SplitterDownloadSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params: z.infer<typeof SplitterDownloadSchema>) => {
    const urlStr = splitterFileDownloadUrl(params.file_id ?? "file", params.blob_url, params.filename ?? "split.pdf");
    return { content: [{ type: "text" as const, text: `Download URL: ${urlStr}` }], structuredContent: { download_url: urlStr } };
  });

  // ── Splitter Tool 4: Download all as ZIP ──────────────────────
  server.registerTool("pdf_splitter_download_all", {
    title: "Download All Split PDFs as ZIP",
    description: `Download all split PDF files as a single ZIP archive.
Also cleans up all blob storage (original + split files).

Args:
  - files: Array of { blobUrl, name } — the split files to include
  - original_blob_url (optional): Original PDF blob URL (will be deleted)
  - zip_name (optional): Base name for ZIP file (default: "split-pdfs")

Returns (JSON):
  {
    "zip_size": 1024000,
    "zip_size_formatted": "1.0 MB",
    "file_count": 3,
    "download_url": "data:application/zip;base64,..."
  }

NOTE: The ZIP is returned as a base64-encoded data URI because Vercel
serverless functions cannot serve binary streams directly to MCP clients.
Save the base64 content as a .zip file to access the split PDFs.`,
    inputSchema: SplitterDownloadAllSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, async (params: z.infer<typeof SplitterDownloadAllSchema>) => {
    try {
      const zipBuffer = await splitterDownloadAll(params.files, params.original_blob_url, params.zip_name);
      const zipBase64 = zipBuffer.toString("base64");
      const sizeMB = (zipBuffer.length / (1024 * 1024)).toFixed(2);
      const output = {
        zip_size: zipBuffer.length,
        zip_size_formatted: `${sizeMB} MB`,
        file_count: params.files.length,
        zip_base64: zipBase64,
      };
      return {
        content: [{ type: "text" as const, text: `ZIP created: ${params.files.length} files, ${sizeMB} MB.\nUse the zip_base64 field from structuredContent to save the archive.` }],
        structuredContent: output,
      };
    } catch (error) { return { isError: true, content: [{ type: "text" as const, text: handleApiError(error) }] }; }
  });

  // ── Splitter Tool 5: Clear blob storage ───────────────────────
  server.registerTool("pdf_splitter_clear", {
    title: "Clear Splitter Session",
    description: `Delete all blob URLs from the PDF Splitter service to free cloud storage.
Call this after downloading individual files, or to cancel a session.

Args:
  - blob_urls: Array of blob URL strings to delete
    Include both the originalBlobUrl and all split file blobUrls.

Returns (JSON):
  { "success": true }`,
    inputSchema: SplitterClearSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, async (params: z.infer<typeof SplitterClearSchema>) => {
    try {
      await splitterClear(params.blob_urls);
      return { content: [{ type: "text" as const, text: `Cleared ${params.blob_urls.length} blob(s).` }], structuredContent: { success: true } };
    } catch (error) { return { isError: true, content: [{ type: "text" as const, text: handleApiError(error) }] }; }
  });

  return server;
}

// ================================================================
// Vercel Handler
// ================================================================

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Use POST." });
    return;
  }

  try {
    const server = buildMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP Handler Error:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
