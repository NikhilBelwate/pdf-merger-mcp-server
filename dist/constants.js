/**
 * Shared constants for the PDF Merger MCP Server.
 */
/** Base URL of the PDF Merger App API (no trailing slash). */
export const API_BASE_URL = process.env.PDF_MERGER_API_URL ?? "https://pdfmerger.omega-x.com"; //"http://localhost:3000";
/** Maximum characters in a single tool response. */
export const CHARACTER_LIMIT = 25_000;
/** Maximum file size accepted by the PDF Merger API (100 MB). */
export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
/** Maximum number of PDFs per session. */
export const MAX_FILE_COUNT = 30;
//# sourceMappingURL=constants.js.map