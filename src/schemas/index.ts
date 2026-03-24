/**
 * Zod schemas for MCP tool input validation.
 */

import { z } from "zod";

/* ------------------------------------------------------------------ */
/*  pdf_merger_upload_pdfs                                              */
/* ------------------------------------------------------------------ */

export const UploadPdfsInputSchema = z
  .object({
    file_paths: z
      .array(z.string().min(1, "File path must not be empty"))
      .min(1, "At least one PDF file path is required")
      .max(30, "Maximum 30 files per upload")
      .describe(
        "Absolute file paths to PDF files on the local filesystem (e.g., [\"/home/user/doc1.pdf\", \"/home/user/doc2.pdf\"])"
      ),
    session_id: z
      .string()
      .uuid("session_id must be a valid UUID")
      .optional()
      .describe(
        "Optional existing session ID to append files to. Omit to create a new session."
      ),
  })
  .strict();

export type UploadPdfsInput = z.infer<typeof UploadPdfsInputSchema>;

/* ------------------------------------------------------------------ */
/*  pdf_merger_list_files                                               */
/* ------------------------------------------------------------------ */

export const ListFilesInputSchema = z
  .object({
    session_id: z
      .string()
      .uuid("session_id must be a valid UUID")
      .describe("Session ID whose files to list."),
  })
  .strict();

export type ListFilesInput = z.infer<typeof ListFilesInputSchema>;

/* ------------------------------------------------------------------ */
/*  pdf_merger_remove_file                                              */
/* ------------------------------------------------------------------ */

export const RemoveFileInputSchema = z
  .object({
    session_id: z
      .string()
      .uuid("session_id must be a valid UUID")
      .describe("Session ID that contains the file."),
    file_id: z
      .string()
      .uuid("file_id must be a valid UUID")
      .describe("ID of the file to remove from the session."),
  })
  .strict();

export type RemoveFileInput = z.infer<typeof RemoveFileInputSchema>;

/* ------------------------------------------------------------------ */
/*  pdf_merger_merge                                                    */
/* ------------------------------------------------------------------ */

export const MergePdfsInputSchema = z
  .object({
    session_id: z
      .string()
      .uuid("session_id must be a valid UUID")
      .describe("Session ID containing uploaded PDFs."),
    file_order: z
      .array(z.string().uuid("Each entry must be a valid file UUID"))
      .min(2, "At least 2 files are required to merge")
      .max(30, "Maximum 30 files per merge")
      .describe(
        "Ordered array of file IDs specifying the merge sequence. The first ID becomes the first pages of the output."
      ),
  })
  .strict();

export type MergePdfsInput = z.infer<typeof MergePdfsInputSchema>;

/* ------------------------------------------------------------------ */
/*  pdf_merger_get_download_url                                         */
/* ------------------------------------------------------------------ */

export const GetDownloadUrlInputSchema = z
  .object({
    token: z
      .string()
      .uuid("token must be a valid UUID")
      .describe(
        "One-time download token returned by the merge operation. Each token can only be used once."
      ),
  })
  .strict();

export type GetDownloadUrlInput = z.infer<typeof GetDownloadUrlInputSchema>;
