/**
 * Vercel API Route for PDF Merger MCP Server
 *
 * This handler bridges the MCP server to Vercel's serverless function model.
 * Each request to /api/mcp is handled as a separate function invocation.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios, { AxiosError } from "axios";
import FormData from "form-data";
import fs from "node:fs";
import path from "node:path";

// Constants
const API_BASE_URL =
  process.env.PDF_MERGER_API_URL ?? "https://pdfmerger.omega-x.com";

// Types
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
// Shared utility functions
// ================================================================

function url(apiPath: string): string {
  return `${API_BASE_URL}${apiPath.startsWith("/") ? "" : "/"}${apiPath}`;
}

function handleApiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const axErr = error as AxiosError<{ error?: string }>;
    if (axErr.response) {
      const body = axErr.response.data;
      const detail =
        typeof body === "object" && body?.error ? body.error : "";
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
  }
  return `Error: ${error instanceof Error ? error.message : String(error)}`;
}

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

  const headers: Record<string, string> = {
    ...form.getHeaders(),
  };
  if (sessionId) {
    headers["x-session-id"] = sessionId;
  }

  const res = await axios.post<UploadResponse>(url("/upload"), form, {
    headers,
    timeout: 120_000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
  return res.data;
}

async function deleteFile(
  sessionId: string,
  fileId: string
): Promise<DeleteFileResponse> {
  const res = await axios.delete<DeleteFileResponse>(
    url(`/file/${sessionId}/${fileId}`),
    { timeout: 30_000 }
  );
  return res.data;
}

async function mergePdfs(
  sessionId: string,
  fileOrder: string[]
): Promise<MergeResponse> {
  const res = await axios.post<MergeResponse>(
    url("/merge"),
    { sessionId, fileOrder },
    {
      headers: { "Content-Type": "application/json" },
      timeout: 120_000,
    }
  );
  return res.data;
}

function downloadUrl(token: string): string {
  return url(`/download/${token}`);
}

// ================================================================
// MCP Server Instance (reused across requests)
// ================================================================

let mcpServer: McpServer | null = null;

function createMcpServer(): McpServer {
  if (mcpServer) {
    return mcpServer;
  }

  const server = new McpServer({
    name: "pdf-merger-mcp-server",
    version: "1.0.0",
  });

  // Tool 1: Upload PDFs
  server.registerTool(
    "pdf_merger_upload_pdfs",
    {
      title: "Upload PDFs",
      description: "Upload one or more PDF files to the PDF Merger service.",
      inputSchema: {
        type: "object",
        properties: {
          file_paths: {
            type: "array",
            items: { type: "string" },
            description: "Absolute paths to PDF files",
          },
          session_id: {
            type: "string",
            description: "Optional existing session ID",
          },
        },
        required: ["file_paths"],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: any) => {
      try {
        const result = await uploadPdfs(
          params.file_paths,
          params.session_id
        );
        if (!result.success) {
          return {
            isError: true,
            content: [{ type: "text", text: `Upload failed: ${result.error}` }],
          };
        }
        const output = {
          session_id: result.sessionId,
          files: result.files ?? [],
        };
        return {
          content: [
            {
              type: "text",
              text: `Uploaded ${output.files.length} file(s)`,
            },
          ],
          structuredContent: output,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleApiError(error) }],
        };
      }
    }
  );

  // Tool 2: Remove File
  server.registerTool(
    "pdf_merger_remove_file",
    {
      title: "Remove File from Session",
      description: "Remove a PDF file from a session.",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          file_id: { type: "string" },
        },
        required: ["session_id", "file_id"],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: any) => {
      try {
        const result = await deleteFile(params.session_id, params.file_id);
        if (!result.success) {
          return {
            isError: true,
            content: [{ type: "text", text: `Remove failed: ${result.error}` }],
          };
        }
        return {
          content: [{ type: "text", text: "File removed" }],
          structuredContent: { success: true },
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleApiError(error) }],
        };
      }
    }
  );

  // Tool 3: Merge PDFs
  server.registerTool(
    "pdf_merger_merge",
    {
      title: "Merge PDFs",
      description: "Merge uploaded PDFs in specified order.",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          file_order: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["session_id", "file_order"],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: any) => {
      try {
        const result = await mergePdfs(
          params.session_id,
          params.file_order
        );
        if (!result.success) {
          return {
            isError: true,
            content: [{ type: "text", text: `Merge failed: ${result.error}` }],
          };
        }
        const output = {
          token: result.token,
          page_count: result.pageCount,
          size_formatted: result.sizeFormatted,
          download_url: downloadUrl(result.token!),
        };
        return {
          content: [
            {
              type: "text",
              text: `Merge complete: ${output.page_count} pages, ${output.size_formatted}`,
            },
          ],
          structuredContent: output,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleApiError(error) }],
        };
      }
    }
  );

  // Tool 4: Get Download URL
  server.registerTool(
    "pdf_merger_get_download_url",
    {
      title: "Get Download URL",
      description: "Get the download URL for a merged PDF.",
      inputSchema: {
        type: "object",
        properties: {
          token: { type: "string" },
        },
        required: ["token"],
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: any) => {
      const urlStr = downloadUrl(params.token);
      return {
        content: [{ type: "text", text: `Download URL: ${urlStr}` }],
        structuredContent: { download_url: urlStr },
      };
    }
  );

  mcpServer = server;
  return server;
}

// ================================================================
// Vercel Handler
// ================================================================

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Only POST is supported
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const server = createMcpServer();
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
