#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  GetPromptRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import express from "express";

// --- Data (shared across transports) ---
const PRODUCTS = [
  { sku: "SKU-001", name: "Wireless Mouse", price: 29.99, stock: 142 },
  { sku: "SKU-002", name: "Mechanical Keyboard", price: 89.99, stock: 57 },
  { sku: "SKU-003", name: "USB-C Hub", price: 45.0, stock: 0 },
];

const RETURN_POLICY =
  "Items can be returned within 30 days of delivery. Opened software is non-refundable. Refunds are processed to the original payment method within 5-7 business days.";

// --- Build a fresh Server per transport (one server per session) ---
function createServer() {
  const server = new Server(
    { name: "powerduck-mcp-demo", version: "0.1.0" },
    { capabilities: { prompts: {}, resources: {}, tools: {} } },
  );

  // Resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: "demo://products/list",
        name: "Product catalog",
        description: "Current list of products with price and stock",
        mimeType: "application/json",
      },
      {
        uri: "demo://policies/returns",
        name: "Return policy",
        description: "Return and refund rules",
        mimeType: "text/plain",
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    if (req.params.uri === "demo://products/list") {
      return {
        contents: [
          {
            uri: req.params.uri,
            mimeType: "application/json",
            text: JSON.stringify(PRODUCTS, null, 2),
          },
        ],
      };
    }
    if (req.params.uri === "demo://policies/returns") {
      return {
        contents: [
          { uri: req.params.uri, mimeType: "text/plain", text: RETURN_POLICY },
        ],
      };
    }
    throw new Error(`Unknown resource: ${req.params.uri}`);
  });

  // Prompts
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      {
        name: "explain-product",
        description: "Generate a customer-facing description for a product by SKU",
        arguments: [
          { name: "sku", description: "Product SKU, e.g. SKU-001", required: true },
          { name: "tone", description: "Voice: casual / professional / playful", required: false },
        ],
      },
      {
        name: "draft-refund-reply",
        description: "Draft a customer support reply for a refund request",
        arguments: [
          { name: "orderId", description: "Order ID", required: true },
          { name: "reason", description: "Why the customer wants a refund", required: true },
        ],
      },
    ],
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    if (req.params.name === "explain-product") {
      const sku = req.params.arguments?.sku ?? "SKU-001";
      const tone = req.params.arguments?.tone ?? "professional";
      return {
        description: `Explain product ${sku} in ${tone} tone`,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Use the product catalog resource to look up SKU ${sku}. Write a short, ${tone} product description a customer would read on the store page. Mention the price and whether it is in stock.`,
            },
          },
        ],
      };
    }
    if (req.params.name === "draft-refund-reply") {
      const orderId = req.params.arguments?.orderId ?? "ORD-0001";
      const reason = req.params.arguments?.reason ?? "defective item";
      return {
        description: `Draft refund reply for ${orderId}`,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Read the return policy resource. The customer for order ${orderId} is asking for a refund because: ${reason}. Write a polite support email that references the policy and tells them what happens next.`,
            },
          },
        ],
      };
    }
    throw new Error(`Unknown prompt: ${req.params.name}`);
  });

  // Tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "search_products",
        description: "Search the local product catalog by name substring",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Substring to match against product name" },
          },
          required: ["query"],
        },
      },
      {
        name: "checkout",
        description: "Reserve stock for a given SKU and quantity. Returns an order confirmation.",
        inputSchema: {
          type: "object",
          properties: {
            sku: { type: "string", description: "Product SKU" },
            quantity: { type: "number", description: "Units to reserve" },
          },
          required: ["sku", "quantity"],
        },
      },
    ],
  }));

  const CheckoutInput = z.object({
    sku: z.string(),
    quantity: z.number().int().positive(),
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name === "search_products") {
      const query = String(req.params.arguments?.query ?? "").toLowerCase();
      const hits = PRODUCTS.filter((p) => p.name.toLowerCase().includes(query));
      return {
        content: [
          {
            type: "text",
            text: hits.length ? JSON.stringify(hits, null, 2) : `No products matching "${query}"`,
          },
        ],
      };
    }

    if (req.params.name === "checkout") {
      const { sku, quantity } = CheckoutInput.parse(req.params.arguments);
      const product = PRODUCTS.find((p) => p.sku === sku);
      if (!product) {
        return { content: [{ type: "text", text: `SKU ${sku} not found.` }], isError: true };
      }
      if (product.stock < quantity) {
        return {
          content: [
            { type: "text", text: `Insufficient stock for ${sku}: have ${product.stock}, requested ${quantity}.` },
          ],
          isError: true,
        };
      }
      const orderId = `ORD-${Math.floor(1000 + Math.random() * 9000)}`;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { orderId, sku, name: product.name, quantity, total: product.price * quantity, status: "confirmed" },
              null,
            ),
          },
        ],
      };
    }

    throw new Error(`Unknown tool: ${req.params.name}`);
  });

  return server;
}

// --- HTTP mode: serve StreamableHTTP on /mcp ---
function startHttp(port = 3011) {
  const app = express();
  app.use(express.json());

  const sessions = new Map();

  app.post("/mcp", async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"];
      let transport = sessionId ? sessions.get(sessionId) : undefined;

      if (!transport) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
        });
        const server = createServer();
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        const sid = transport.sessionId;
        console.error(`[mcp-demo] new session: ${sid}`);
        if (sid) {
          sessions.set(sid, transport);
          transport.onclose = () => {
            console.error(`[mcp-demo] session closed: ${sid}`);
            sessions.delete(sid);
          };
        }
        return;
      }

      console.error(`[mcp-demo] existing session: ${sessionId}, method=${req.body?.method}`);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[mcp-demo] handler error:", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: err.message },
          id: req.body?.id ?? null,
        });
      }
    }
  });

  app.get("/mcp", (req, res) => res.status(405).send("Use POST"));
  app.delete("/mcp", async (req, res) => {
    const sid = req.headers["mcp-session-id"];
    const t = sid ? sessions.get(sid) : undefined;
    if (t) {
      await t.handleRequest(req, res);
      sessions.delete(sid);
    } else {
      res.status(400).send("No session");
    }
  });

  app.listen(port, () => {
    console.error(`[mcp-demo] HTTP mode: http://127.0.0.1:${port}/mcp`);
  });
}

// --- Entry: stdio by default, --http enables HTTP ---
async function main() {
  const mode = process.argv.includes("--http") ? "http" : "stdio";

  if (mode === "http") {
    const port = Number(process.env.PORT ?? 3011);
    startHttp(port);
    return;
  }

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp-demo] stdio mode");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
