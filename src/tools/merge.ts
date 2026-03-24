/**
 * Tool: pdf_merger_merge
 *
 * Merge uploaded PDFs in a specified order and receive a one-time download token.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MergePdfsInputSchema, type MergePdfsInput } from "../schemas/index.js";
import { mergePdfs, downloadUrl, handleApiError } from "../services/api-client.js";

export function registerMergeTool(server: McpServer): void {
  server.registerTool(
    "pdf_merger_merge",
    {
      title: "Merge PDFs",
      description: `Merge previously uploaded PDFs in a specified order into a single PDF.

Returns a one-time download token. Use pdf_merger_get_download_url to build the download link.
The session is consumed after merging — re-upload files to merge again.

Args:
  - session_id (string): UUID of the upload session.
  - file_order (string[]): Ordered array of file UUIDs. The first entry becomes the first pages of the merged output.
    Must contain at least 2 file IDs and at most 30.

Returns (JSON):
  {
    "token": "uuid",
    "page_count": 45,
    "size_formatted": "2.3 MB",
    "download_url": "https://..."
  }

Workflow:
  1. Upload PDFs using pdf_merger_upload_pdfs
  2. (Optional) Remove unwanted files using pdf_merger_remove_file
  3. Merge using this tool with desired file order
  4. Use the returned download_url to download the merged PDF

Error Handling:
  - Session not found → 404
  - File order contains unknown IDs → 400
  - Encrypted/corrupt PDF → 422
  - Less than 2 files → 400`,
      inputSchema: MergePdfsInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: MergePdfsInput) => {
      try {
        const result = await mergePdfs(params.session_id, params.file_order);

        if (!result.success) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Merge failed: ${result.error ?? "Unknown error"}`,
              },
            ],
          };
        }

        const token = result.token!;
        const output = {
          token,
          page_count: result.pageCount ?? 0,
          size_formatted: result.sizeFormatted ?? "unknown",
          download_url: downloadUrl(token),
        };

        const text = [
          "Merge complete!",
          "",
          `- **Pages**: ${output.page_count}`,
          `- **Size**: ${output.size_formatted}`,
          `- **Download URL**: ${output.download_url}`,
          "",
          "_Note: This is a one-time download link. It expires after a single use._",
        ].join("\n");

        return {
          content: [{ type: "text" as const, text }],
          structuredContent: output,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: handleApiError(error) }],
        };
      }
    }
  );
}
