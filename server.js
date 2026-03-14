/**
 * Imagify MCP Server — Single File, Ready for Glitch
 * Paste this file + package.json into Glitch and set IMAGIFY_API_KEY in environment variables.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import axios from "axios";
import { z } from "zod";

// ─── Config ──────────────────────────────────────────────────────────────────

const API_KEY = process.env.IMAGIFY_API_KEY;
const PORT = process.env.PORT || 3000;

if (!API_KEY) {
  console.warn("WARNING: IMAGIFY_API_KEY environment variable is not set — API calls will return errors until configured in Railway Variables tab");
}

// ─── Imagify API Client ───────────────────────────────────────────────────────

async function imagifyRequest(endpoint, payload) {
  try {
    const res = await axios.post(`https://api.imagify.io/v1/${endpoint}`, payload, {
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      timeout: 30000
    });
    return res.data;
  } catch (err) {
    if (err.response) {
      const status = err.response.status;
      if (status === 401) throw new Error("Invalid Imagify API key — check your IMAGIFY_API_KEY");
      if (status === 429) throw new Error("Rate limit exceeded — wait before retrying");
      if (status === 400) throw new Error(`Bad request: ${err.response.data?.message || "check your parameters"}`);
      throw new Error(`Imagify API error ${status}: ${err.response.data?.message || "unknown"}`);
    }
    throw new Error(`Network error: ${err.message}`);
  }
}

// ─── Build MCP Server ─────────────────────────────────────────────────────────

function buildServer() {
  const server = new McpServer({ name: "imagify-mcp-server", version: "1.0.0" });

  // Tool 1 — Optimize Image
  server.registerTool(
    "imagify_optimize_image",
    {
      title: "Optimize Image",
      description: `Upload an image URL to Imagify for compression and optimization.
Use 'smart' for maximum compression (40–70% reduction) or 'lossless' for zero quality loss.
Optionally resize the image at the same time.

Args:
  - image_url: Public URL of the image to optimize
  - compression: 'smart' (default) or 'lossless'
  - resize_width: Optional target width in pixels
  - resize_height: Optional target height in pixels

Returns: original size, optimized size, % saved, and download URL.`,
      inputSchema: z.object({
        image_url: z.string().url().describe("Public URL of the image"),
        compression: z.enum(["smart", "lossless"]).default("smart").describe("Compression type"),
        resize_width: z.number().int().positive().optional().describe("Optional resize width in px"),
        resize_height: z.number().int().positive().optional().describe("Optional resize height in px")
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ image_url, compression, resize_width, resize_height }) => {
      try {
        const payload = { source: { type: "url", url: image_url }, compression };
        if (resize_width || resize_height) payload.resize = { width: resize_width, height: resize_height };

        const result = await imagifyRequest("optimization", payload);

        const savedMB = ((result.original_size - result.optimized_size) / 1024 / 1024).toFixed(2);
        const text = `✅ Optimization complete!\n\n` +
          `- Original: ${(result.original_size / 1024 / 1024).toFixed(2)} MB\n` +
          `- Optimized: ${(result.optimized_size / 1024 / 1024).toFixed(2)} MB\n` +
          `- Saved: ${savedMB} MB (${result.compression_percentage}% reduction)\n` +
          `- Dimensions: ${result.width}×${result.height}px\n\n` +
          `[Download optimized image](${result.download_url})`;

        return { content: [{ type: "text", text }], structuredContent: result };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // Tool 2 — Convert Format
  server.registerTool(
    "imagify_convert_image",
    {
      title: "Convert Image Format",
      description: `Convert an image to a different format via Imagify.
Supported formats: jpeg, png, webp, avif, gif, pdf.
WebP and AVIF give superior compression vs JPEG/PNG.

Args:
  - image_url: Public URL of the image to convert
  - format: Target format (jpeg | png | webp | avif | gif | pdf)
  - compression: 'smart' (default) or 'lossless'

Returns: converted file size, dimensions, and download URL.`,
      inputSchema: z.object({
        image_url: z.string().url().describe("Public URL of the image"),
        format: z.enum(["jpeg", "png", "webp", "avif", "gif", "pdf"]).describe("Target format"),
        compression: z.enum(["smart", "lossless"]).default("smart").describe("Compression type")
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ image_url, format, compression }) => {
      try {
        const result = await imagifyRequest("conversion", {
          source: { type: "url", url: image_url },
          target_format: format,
          compression
        });

        const text = `✅ Conversion complete!\n\n` +
          `- Format: ${result.original_format?.toUpperCase()} → ${format.toUpperCase()}\n` +
          `- File size: ${(result.file_size / 1024 / 1024).toFixed(2)} MB\n` +
          `- Dimensions: ${result.width}×${result.height}px\n\n` +
          `[Download converted image](${result.download_url})`;

        return { content: [{ type: "text", text }], structuredContent: result };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // Tool 3 — Resize Image
  server.registerTool(
    "imagify_resize_image",
    {
      title: "Resize Image",
      description: `Resize an image to specific pixel dimensions via Imagify.
Modes: 'fit' (default, no distortion), 'crop' (exact dimensions, cropped), 'scale' (exact, may distort).

Args:
  - image_url: Public URL of the image
  - width: Target width in pixels
  - height: Target height in pixels
  - mode: 'fit' (default) | 'crop' | 'scale'

Returns: new dimensions, file size, and download URL.`,
      inputSchema: z.object({
        image_url: z.string().url().describe("Public URL of the image"),
        width: z.number().int().positive().describe("Target width in pixels"),
        height: z.number().int().positive().describe("Target height in pixels"),
        mode: z.enum(["fit", "crop", "scale"]).default("fit").describe("Resize mode")
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ image_url, width, height, mode }) => {
      try {
        const result = await imagifyRequest("resize", {
          source: { type: "url", url: image_url },
          dimensions: { width, height },
          mode
        });

        const text = `✅ Resize complete!\n\n` +
          `- Original: ${result.original_width}×${result.original_height}px\n` +
          `- New size: ${result.new_width}×${result.new_height}px\n` +
          `- File size: ${(result.file_size / 1024 / 1024).toFixed(2)} MB\n\n` +
          `[Download resized image](${result.download_url})`;

        return { content: [{ type: "text", text }], structuredContent: result };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  // Tool 4 — Compression Info
  server.registerTool(
    "imagify_compression_info",
    {
      title: "Get Compression Info",
      description: "Returns details about available Imagify compression levels and supported formats.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async () => {
      const text = `# Imagify Compression Options\n\n` +
        `**Smart** — 40–70% file size reduction, minimal quality loss. Best for web images.\n` +
        `**Lossless** — 10–30% reduction, zero quality loss. Best for photography/archival.\n\n` +
        `**Supported input formats:** JPEG, PNG, GIF (animated), PDF\n` +
        `**Supported output formats:** JPEG, PNG, WebP, AVIF, GIF, PDF\n\n` +
        `💡 WebP and AVIF give 25–35% better compression than JPEG/PNG at the same quality.`;
      return { content: [{ type: "text", text }] };
    }
  );

  return server;
}

// ─── HTTP Server (Streamable HTTP for Claude connector) ───────────────────────

const app = express();
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok", server: "imagify-mcp-server" });
});

app.all("/mcp", async (req, res) => {
  // Claude's connector omits text/event-stream from the Accept header, which the MCP SDK
  // requires. Patch it before the transport reads it.
  if (!req.headers['accept']?.includes('text/event-stream')) {
    req.headers['accept'] = 'application/json, text/event-stream';
  }

  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    res.on("close", () => transport.close());
    const server = buildServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[MCP ERROR]', err.message, err.stack);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Imagify MCP server running on port ${PORT}`);
  console.log(`   Connect Claude at: https://YOUR-PROJECT.glitch.me/mcp`);
});
