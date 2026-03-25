/**
 * Vercel API Route for PDF Merger MCP Server
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

const API_BASE_URL =
  process.env.PDF_MERGER_API_URL ?? "https://pdfmerger.omega-x.com";

// ================================================================
// TypeScript interfaces
// ================================================================

interface PdfFileEntry {
  id: string;
  name: string;
  size: number;
  sizeFormatted: string;
}

interface UploadResponse {
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

// ================================================================
// Zod Schemas
// ================================================================

const UploadPdfsInputSchema = z.object({
  file_paths: z
    .array(z.string().min(1))
    .min(1)
    .max(30)
    .describe("Absolute local file paths — only valid for self-hosted deployments"),
  session_id: z.string().uuid().optional().describe("Existing session ID"),
});

/** New schema for base64 upload — works on Vercel / any remote deployment */
const UploadBase64InputSchema = z.object({
  files: z
    .array(
      z.object({
        name: z
          .string()
          .min(1)
          .describe("Filename including .pdf extension (e.g. report.pdf)"),
        content: z
          .string()
          .min(1)
          .describe("Base64-encoded PDF file content"),
      })
    )
    .min(1)
    .max(30)
    .describe("Array of PDF files encoded as base64 strings"),
  session_id: z
    .string()
    .uuid()
    .optional()
    .describe("Optional existing session ID to append files to"),
});

const RemoveFileInputSchema = z.object({
  session_id: z.string().uuid().describe("Session ID"),
  file_id: z.string().uuid().describe("File ID to remove"),
});

const MergePdfsInputSchema = z.object({
  session_id: z.string().uuid().describe("Session ID"),
  file_order: z
    .array(z.string().uuid())
    .min(2)
    .max(30)
    .describe("Ordered list of file IDs — first entry = first pages in output"),
});

const GetDownloadUrlInputSchema = z.object({
  token: z.string().uuid().describe("One-time download token from merge"),
});

// ================================================================
// API helpers
// ================================================================

function apiUrl(apiPath: string): string {
  return `${API_BASE_URL}${apiPath.startsWith("/") ? "" : "/"}${apiPath}`;
}

function handleApiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const axErr = error as AxiosError<{ error?: string }>;
    if (axErr.response) {
      const body = axErr.response.data;
      const detail = typeof body === "object" && body?.error ? body.error : "";
      switch (axErr.response.status) {
        case 400: return `Error (400 Bad Request): ${detail || "Invalid parameters."}`;
        case 404: return `Error (404 Not Found): ${detail || "Resource not found."}`;
        case 413: return `Error (413 Payload Too Large): ${detail || "File exceeds 100 MB."}`;
        case 415: return `Error (415 Unsupported Media Type): ${detail || "Only PDFs accepted."}`;
        case 422: return `Error (422): ${detail || "PDF may be encrypted or corrupt."}`;
        case 502: return `Error (502 Bad Gateway): ${detail || "Storage unavailable."}`;
        default:  return `Error (${axErr.response.status}): ${detail || axErr.message}`;
      }
    }
  }
  return `Error: ${error instanceof Error ? error.message : String(error)}`;
}

/** Upload files from local/tmp paths to PDF Merger App */
async function uploadPdfs(
  filePaths: string[],
  sessionId?: string
): Promise<UploadResponse> {
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

  const headers: Record<string, string> = { ...form.getHeaders() };
  if (sessionId) headers["x-session-id"] = sessionId;

  const res = await axios.post<UploadResponse>(apiUrl("/upload"), form, {
    headers,
    timeout: 120_000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
  return res.data;
}

/** Delete a single file from a session */
async function deleteFile(
  sessionId: string,
  fileId: string
): Promise<DeleteFileResponse> {
  const res = await axios.delete<DeleteFileResponse>(
    apiUrl(`/file/${sessionId}/${fileId}`),
    { timeout: 30_000 }
  );
  return res.data;
}

/** Merge files in the given order */
async function mergePdfs(
  sessionId: string,
  fileOrder: string[]
): Promise<MergeResponse> {
  const res = await axios.post<MergeResponse>(
    apiUrl("/merge"),
    { sessionId, fileOrder },
    { headers: { "Content-Type": "application/json" }, timeout: 120_000 }
  );
  return res.data;
}

function buildDownloadUrl(token: string): string {
  return apiUrl(`/download/${token}`);
}

// ================================================================
// MCP Server factory — FRESH INSTANCE per request to avoid
// "Already connected to a transport" on warm Vercel instances.
// ================================================================

function buildMcpServer(): McpServer {
  const server = new McpServer({
    name: "pdf-merger-mcp-server",
    version: "1.0.0",
  });

  // ── Tool 1: Upload via file paths (local / self-hosted only) ──────
  server.registerTool(
    "pdf_merger_upload_pdfs",
    {
      title: "Upload PDFs (local paths)",
      description: `Upload PDF files by absolute filesystem path.
NOTE: Only works when the MCP server runs on the same machine as the files.
For Vercel / remote deployments use pdf_merger_upload_base64 instead.`,
      inputSchema: UploadPdfsInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof UploadPdfsInputSchema>) => {
      try {
        const result = await uploadPdfs(params.file_paths, params.session_id);
        if (!result.success) {
          return { isError: true, content: [{ type: "text" as const, text: `Upload failed: ${result.error}` }] };
        }
        const output = { session_id: result.sessionId, files: result.files ?? [] };
        return {
          content: [{ type: "text" as const, text: `Uploaded ${output.files.length} file(s) — session: ${output.session_id}` }],
          structuredContent: output,
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text" as const, text: handleApiError(error) }] };
      }
    }
  );

  // ── Tool 2: Upload via base64 (works on Vercel / any remote host) ─
  server.registerTool(
    "pdf_merger_upload_base64",
    {
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
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof UploadBase64InputSchema>) => {
      const tmpPaths: string[] = [];
      try {
        // Step 1: Decode each base64 file → write to /tmp
        for (const file of params.files) {
          let buffer: Buffer;
          try {
            buffer = Buffer.from(file.content, "base64");
          } catch {
            return {
              isError: true,
              content: [{ type: "text" as const, text: `Failed to decode base64 for file "${file.name}".` }],
            };
          }

          // Validate PDF magic bytes (%PDF)
          if (
            buffer.length < 4 ||
            buffer[0] !== 0x25 || // %
            buffer[1] !== 0x50 || // P
            buffer[2] !== 0x44 || // D
            buffer[3] !== 0x46    // F
          ) {
            return {
              isError: true,
              content: [{ type: "text" as const, text: `"${file.name}" does not appear to be a valid PDF (bad magic bytes).` }],
            };
          }

          // Sanitise filename — strip directory traversal chars
          const safeName = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, "_");
          const tmpPath = `/tmp/${randomUUID()}_${safeName}`;
          await fsp.writeFile(tmpPath, buffer);
          tmpPaths.push(tmpPath);
        }

        // Step 2: Forward to PDF Merger App via multipart upload
        const result = await uploadPdfs(tmpPaths, params.session_id);

        if (!result.success) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `Upload failed: ${result.error}` }],
          };
        }

        const output = { session_id: result.sessionId, files: result.files ?? [] };
        const summary = output.files
          .map((f) => `  - ${f.name} (${f.sizeFormatted}) → id: ${f.id}`)
          .join("\n");

        return {
          content: [{
            type: "text" as const,
            text: `Uploaded ${output.files.length} file(s) to session ${output.session_id}:\n${summary}`,
          }],
          structuredContent: output,
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text" as const, text: handleApiError(error) }] };
      } finally {
        // Step 3: Always clean up /tmp files
        for (const tmpPath of tmpPaths) {
          fsp.unlink(tmpPath).catch(() => { /* ignore cleanup errors */ });
        }
      }
    }
  );

  // ── Tool 3: Remove file ───────────────────────────────────────────
  server.registerTool(
    "pdf_merger_remove_file",
    {
      title: "Remove File from Session",
      description: "Permanently remove a PDF file from an upload session.",
      inputSchema: RemoveFileInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof RemoveFileInputSchema>) => {
      try {
        const result = await deleteFile(params.session_id, params.file_id);
        if (!result.success) {
          return { isError: true, content: [{ type: "text" as const, text: `Remove failed: ${result.error}` }] };
        }
        return {
          content: [{ type: "text" as const, text: `File ${params.file_id} removed.` }],
          structuredContent: { success: true },
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text" as const, text: handleApiError(error) }] };
      }
    }
  );

  // ── Tool 4: Merge ─────────────────────────────────────────────────
  server.registerTool(
    "pdf_merger_merge",
    {
      title: "Merge PDFs",
      description: "Merge uploaded PDFs in specified order. Returns a one-time download token.",
      inputSchema: MergePdfsInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof MergePdfsInputSchema>) => {
      try {
        const result = await mergePdfs(params.session_id, params.file_order);
        if (!result.success) {
          return { isError: true, content: [{ type: "text" as const, text: `Merge failed: ${result.error}` }] };
        }
        const output = {
          token: result.token!,
          page_count: result.pageCount,
          size_formatted: result.sizeFormatted,
          download_url: buildDownloadUrl(result.token!),
        };
        return {
          content: [{
            type: "text" as const,
            text: `Merge complete: ${output.page_count} pages, ${output.size_formatted}\nDownload: ${output.download_url}`,
          }],
          structuredContent: output,
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text" as const, text: handleApiError(error) }] };
      }
    }
  );

  // ── Tool 5: Get download URL ──────────────────────────────────────
  server.registerTool(
    "pdf_merger_get_download_url",
    {
      title: "Get Download URL",
      description: "Build the one-time download URL from a merge token.",
      inputSchema: GetDownloadUrlInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: z.infer<typeof GetDownloadUrlInputSchema>) => {
      const urlStr = buildDownloadUrl(params.token);
      return {
        content: [{ type: "text" as const, text: `Download URL: ${urlStr}` }],
        structuredContent: { download_url: urlStr },
      };
    }
  );

  return server;
}

// ================================================================
// Vercel Handler
// ================================================================

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Use POST." });
    return;
  }

  try {
    // Create fresh server + transport per request.
    // This is the correct pattern for stateless serverless environments
    // because McpServer tracks its connected transport internally and
    // throws "Already connected" if you call connect() twice on the
    // same instance.
    const server = buildMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — no session tracking
      enableJsonResponse: true,
    });

    // Always await connect before handling
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
