/**
 * Tool: pdf_merger_upload_pdfs
 *
 * Upload one or more PDF files to the PDF Merger API.
 */
import { UploadPdfsInputSchema } from "../schemas/index.js";
import { uploadPdfs, handleApiError } from "../services/api-client.js";
export function registerUploadTool(server) {
    server.registerTool("pdf_merger_upload_pdfs", {
        title: "Upload PDFs",
        description: `Upload one or more PDF files to the PDF Merger service for later merging.

Each file must be a valid PDF (≤100 MB). Up to 30 files can be uploaded per session.
If session_id is provided, files are appended to that existing session; otherwise a new session is created.

Args:
  - file_paths (string[]): Absolute paths to PDF files on disk.
  - session_id (string, optional): UUID of existing session to append to.

Returns (JSON):
  {
    "session_id": "uuid",
    "files": [
      { "id": "uuid", "name": "doc.pdf", "size": 102400, "sizeFormatted": "100.0 KB" }
    ]
  }

Examples:
  - Upload two files to a new session:
    file_paths=["/tmp/report.pdf", "/tmp/appendix.pdf"]
  - Append to existing session:
    file_paths=["/tmp/extra.pdf"], session_id="550e8400-..."

Error Handling:
  - File not found on disk → clear message with the missing path
  - Non-PDF file → 415 error from API
  - File >100 MB → 413 error from API
  - >30 files in session → 400 error from API`,
        inputSchema: UploadPdfsInputSchema,
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, async (params) => {
        try {
            const result = await uploadPdfs(params.file_paths, params.session_id);
            if (!result.success) {
                return {
                    isError: true,
                    content: [
                        {
                            type: "text",
                            text: `Upload failed: ${result.error ?? "Unknown error"}`,
                        },
                    ],
                };
            }
            const output = {
                session_id: result.sessionId,
                files: result.files ?? [],
            };
            const lines = [
                `Uploaded ${output.files.length} file(s) to session **${output.session_id}**`,
                "",
            ];
            for (const f of output.files) {
                lines.push(`- **${f.name}** (${f.sizeFormatted}) — ID: \`${f.id}\``);
            }
            return {
                content: [{ type: "text", text: lines.join("\n") }],
                structuredContent: output,
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
//# sourceMappingURL=upload.js.map