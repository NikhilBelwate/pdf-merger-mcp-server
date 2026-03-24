/**
 * Tool: pdf_merger_remove_file
 *
 * Remove a single file from an upload session.
 */
import { RemoveFileInputSchema } from "../schemas/index.js";
import { deleteFile, handleApiError } from "../services/api-client.js";
export function registerRemoveTool(server) {
    server.registerTool("pdf_merger_remove_file", {
        title: "Remove File from Session",
        description: `Remove a single PDF file from an upload session on the PDF Merger service.

The file is permanently deleted from cloud storage. This operation cannot be undone.

Args:
  - session_id (string): UUID of the session containing the file.
  - file_id (string): UUID of the file to remove.

Returns (JSON):
  { "success": true }

Error Handling:
  - Session not found → 404 error
  - File not found in session → 404 error`,
        inputSchema: RemoveFileInputSchema,
        annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async (params) => {
        try {
            const result = await deleteFile(params.session_id, params.file_id);
            if (!result.success) {
                return {
                    isError: true,
                    content: [
                        {
                            type: "text",
                            text: `Remove failed: ${result.error ?? "Unknown error"}`,
                        },
                    ],
                };
            }
            return {
                content: [
                    {
                        type: "text",
                        text: `File \`${params.file_id}\` removed from session \`${params.session_id}\`.`,
                    },
                ],
                structuredContent: { success: true },
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: handleApiError(error) }],
            };
        }
    });
}
//# sourceMappingURL=remove.js.map