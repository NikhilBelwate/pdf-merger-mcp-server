# PDF Merger MCP Server

An MCP (Model Context Protocol) server that exposes the **PDF Merger App** as a set of tools any MCP-compatible LLM client can use to upload, arrange, merge, and download PDFs.

## Tools

| Tool | Description |
|------|-------------|
| `pdf_merger_upload_pdfs` | Upload one or more PDF files from disk to the merger service |
| `pdf_merger_remove_file` | Remove a file from an upload session |
| `pdf_merger_merge` | Merge uploaded PDFs in a specified order |
| `pdf_merger_get_download_url` | Build a one-time download URL for the merged result |

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Run (stdio transport — default)
PDF_MERGER_API_URL=http://localhost:3000 npm start

# Run (HTTP transport for remote access)
TRANSPORT=http PORT=4000 PDF_MERGER_API_URL=http://localhost:3000 npm start
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PDF_MERGER_API_URL` | `http://localhost:3000` | Base URL of the PDF Merger App API |
| `TRANSPORT` | `stdio` | Transport mode: `stdio` or `http` |
| `PORT` | `4000` | HTTP server port (only when `TRANSPORT=http`) |

## Claude Desktop Configuration

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pdf-merger": {
      "command": "node",
      "args": ["/path/to/pdf-merger-mcp-server/dist/index.js"],
      "env": {
        "PDF_MERGER_API_URL": "https://your-merger-app.vercel.app"
      }
    }
  }
}
```

## Typical Workflow

1. **Upload** PDFs → returns `session_id` + file IDs
2. **Remove** unwanted files (optional)
3. **Merge** with desired file order → returns one-time download `token`
4. **Download** using the token URL

## Architecture

```
LLM Client ──MCP──▶ pdf-merger-mcp-server ──HTTP──▶ PDF Merger App (Express)
                     (stdio or HTTP)                  (Vercel Blob + pdf-lib)
```

## Development

```bash
npm run dev    # Auto-reload via tsx watch
npm run build  # Compile TypeScript → dist/
npm run clean  # Remove dist/
```
