/**
 * Tool: pdf_merger_get_download_url
 *
 * Build the one-time download URL for a previously merged PDF.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  GetDownloadUrlInputSchema,
  type GetDownloadUrlInput,
} from "../schemas/index.js";
import { downloadUrl } from "../services/api-client.js";

export function registerDownloadTool(server: McpServer): void {
  server.registerTool(
    "pdf_merger_get_download_url",
    {
      title: "Get Download URL",
      description: `Build a one-time download URL for a merged PDF.

The token is returned by pdf_merger_merge. Each token can only be used once;
after the first download the link expires and all associated cloud files are cleaned up.

Args:
  - token (string): One-time download token UUID from the merge response.

Returns (JSON):
  { "download_url": "https://your-api.example.com/download/<token>" }

Notes:
  - Opening the URL in a browser triggers a file download of "merged.pdf".
  - After download, source blobs are automatically deleted from cloud storage.`,
      inputSchema: GetDownloadUrlInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: GetDownloadUrlInput) => {
      const urlStr = downloadUrl(params.token);
      const output = { download_url: urlStr };

      return {
        content: [
          {
            type: "text" as const,
            text: `Download URL: ${urlStr}\n\n_One-time use — link expires after first download._`,
          },
        ],
        structuredContent: output,
      };
    }
  );
}
