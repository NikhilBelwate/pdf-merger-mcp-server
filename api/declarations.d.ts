/**
 * Ambient type declarations for modules that do not ship their own .d.ts files.
 */

declare module "@modelcontextprotocol/sdk/server/mcp.js" {
  import { z } from "zod";

  interface McpServerOptions {
    name: string;
    version: string;
  }

  interface ToolAnnotations {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  }

  interface ToolConfig<TInput extends z.ZodRawShape> {
    title: string;
    description: string;
    inputSchema: z.ZodObject<TInput>;
    outputSchema?: z.ZodRawShape;
    annotations?: ToolAnnotations;
  }

  interface ToolContent {
    type: "text";
    text: string;
  }

  interface ToolResult {
    content: ToolContent[];
    structuredContent?: unknown;
    isError?: boolean;
  }

  export class McpServer {
    constructor(options: McpServerOptions);
    registerTool<TInput extends z.ZodRawShape>(
      name: string,
      config: ToolConfig<TInput>,
      handler: (params: z.infer<z.ZodObject<TInput>>) => Promise<ToolResult>
    ): void;
    connect(transport: unknown): Promise<void>;
  }
}

declare module "@modelcontextprotocol/sdk/server/stdio.js" {
  export class StdioServerTransport {
    constructor();
  }
}

declare module "express" {
  function express(): express.Application;
  namespace express {
    interface Application {
      use(middleware: unknown): Application;
      post(path: string, handler: (req: unknown, res: unknown) => Promise<void>): void;
      listen(port: number, callback?: () => void): void;
    }
    function json(): unknown;
  }
  export default express;
}

declare module "@modelcontextprotocol/sdk/server/streamableHttp.js" {
  interface StreamableHTTPServerTransportOptions {
    sessionIdGenerator?: (() => string) | undefined;
    enableJsonResponse?: boolean;
  }

  export class StreamableHTTPServerTransport {
    constructor(options: StreamableHTTPServerTransportOptions);
    close(): void;
    handleRequest(req: unknown, res: unknown, body: unknown): Promise<void>;
  }
}
