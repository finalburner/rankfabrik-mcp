# Installation guide for AI agents (Cline, etc.)

This file guides an AI agent to install and configure the **rankfabrik-mcp**
server. It proxies the 4 RankFabrik REST APIs — Places, Jobs, Captions, Verify —
behind a single federated `rf_` key.

## 1. Prerequisite: an API key

The user needs a RankFabrik federated key (`rf_…`). A free trial key
(500 units, no card) is available at https://rankfabrik.com/tarifs

Ask the user to paste their `rf_…` key. If they don't have one yet, point them
to the URL above, then continue once they provide it.

## 2. Configuration (no clone — npx)

Add this block to the user's MCP settings (`cline_mcp_settings.json`, or the
equivalent `mcpServers` map of their client). Replace `rf_xxx` with the user's
real key:

```json
{
  "mcpServers": {
    "rankfabrik": {
      "command": "npx",
      "args": ["-y", "rankfabrik-mcp"],
      "env": { "RANKFABRIK_API_KEY": "rf_xxx" }
    }
  }
}
```

No global install is required — `npx -y` fetches the published npm package
`rankfabrik-mcp` on first run. The server speaks MCP over **stdio** (the default
transport), so no port or URL is needed.

## 3. Verify

After the client reloads its MCP servers, the `rankfabrik` server should expose
tools for the 4 products (place search, job search, caption transcription, email
verification). Call any tool once: if the key doesn't yet cover that product,
the tool returns an actionable activation message (not a crash), so the channel
stays usable product by product.

## Notes

- **Package:** `rankfabrik-mcp` (npm) · **Registry name:** `io.github.finalburner/rankfabrik-mcp`
- **Required env:** `RANKFABRIK_API_KEY` (the `rf_…` federated key).
- **Optional env:** `RANKFABRIK_EN_TETE_CLE` (HTTP header carrying the key,
  default `x-cle-api`), `RANKFABRIK_URL_CLE` (onboarding URL shown in messages).
- The key is passed only to the RankFabrik production APIs over HTTPS; it is
  never stored by the MCP server itself.
