# mcp-demo

Minimal local MCP server with all three primitives: **prompts**, **tools**, **resources**.
Runs in **stdio** (default) or **HTTP** (`--http`) mode.

## Run

```bash
npm install

# stdio (default, for Claude Desktop / Claude Code)
npm start

# HTTP (Streamable HTTP, for remote clients / browser)
npm run start:http
# or
PORT=3011 node index.js --http
```

## stdio mode

Add to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "powerduck-demo": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-demo/index.js"]
    }
  }
}
```

Replace `/absolute/path/to/mcp-demo/index.js` with the absolute path to this file in your local clone.

## HTTP mode

Start it:

```bash
npm run start:http
# listens on http://127.0.0.1:3011/mcp
```

Configure an HTTP MCP client with URL `http://127.0.0.1:3011/mcp`.
The server issues a `Mcp-Session-Id` header on `initialize`; send it back on subsequent requests.

Quick curl smoke test:

```bash
curl -X POST http://127.0.0.1:3011/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

## What's exposed

### Resources
- `demo://products/list` — product catalog JSON
- `demo://policies/returns` — return policy text

### Prompts
- `explain-product` — args: `sku`, `tone?`
- `draft-refund-reply` — args: `orderId`, `reason`

### Tools
- `search_products(query)` — substring search on product names
- `checkout(sku, quantity)` — validates stock, returns order confirmation
