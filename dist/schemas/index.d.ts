/**
 * Zod schemas for MCP tool input validation.
 */
import { z } from "zod";
export declare const UploadPdfsInputSchema: z.ZodObject<{
    file_paths: z.ZodArray<z.ZodString, "many">;
    session_id: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    file_paths: string[];
    session_id?: string | undefined;
}, {
    file_paths: string[];
    session_id?: string | undefined;
}>;
export type UploadPdfsInput = z.infer<typeof UploadPdfsInputSchema>;
export declare const ListFilesInputSchema: z.ZodObject<{
    session_id: z.ZodString;
}, "strict", z.ZodTypeAny, {
    session_id: string;
}, {
    session_id: string;
}>;
export type ListFilesInput = z.infer<typeof ListFilesInputSchema>;
export declare const RemoveFileInputSchema: z.ZodObject<{
    session_id: z.ZodString;
    file_id: z.ZodString;
}, "strict", z.ZodTypeAny, {
    session_id: string;
    file_id: string;
}, {
    session_id: string;
    file_id: string;
}>;
export type RemoveFileInput = z.infer<typeof RemoveFileInputSchema>;
export declare const MergePdfsInputSchema: z.ZodObject<{
    session_id: z.ZodString;
    file_order: z.ZodArray<z.ZodString, "many">;
}, "strict", z.ZodTypeAny, {
    session_id: string;
    file_order: string[];
}, {
    session_id: string;
    file_order: string[];
}>;
export type MergePdfsInput = z.infer<typeof MergePdfsInputSchema>;
export declare const GetDownloadUrlInputSchema: z.ZodObject<{
    token: z.ZodString;
}, "strict", z.ZodTypeAny, {
    token: string;
}, {
    token: string;
}>;
export type GetDownloadUrlInput = z.infer<typeof GetDownloadUrlInputSchema>;
//# sourceMappingURL=index.d.ts.map