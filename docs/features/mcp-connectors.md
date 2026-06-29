# MCP Connectors

MCP connectors let **external AI clients drive this Instatic instance** over the [Model Context Protocol](https://modelcontextprotocol.io). Instatic acts as an **MCP server**: a local client (Claude Code, Codex, Cursor) or a remote agent connects, lists the available tools, and operates the CMS — reading the site, editing page structure, and managing content — exactly the way the built-in AI panel does.

This is the mirror image of the **Providers** tab (`server/ai/credentials/`), which points Instatic's *own* agent outward at LLM providers. MCP connectors point inward: they let outside agents reach in.

The server is implemented with the official `@modelcontextprotocol/sdk`. That package is banned everywhere else in the tree (the AI drivers hand-roll provider REST); it is allowed **only under `server/ai/mcp/`**, scoped by `ai-driver-isolation.test.ts`.

---

## TL;DR

- **Instatic is an MCP server.** One Streamable-HTTP endpoint at `/_instatic/mcp` serves both local and remote clients (local is just `localhost`).
- **Thin adapter over the existing tool engine.** No tool logic is duplicated. MCP is a new *caller* alongside the built-in agent and the plugin host; tool dispatch reuses `executeAiTool`, and visual editing reuses the headless page-tree service.
- **Tool surface:** the server-resolved content tools (pages, posts, data, media — read/write) plus `read_page_tree` / `mutate_page_tree` for headless visual/structure editing.
- **Bearer-token auth, one secret per connector.** The token is shown once on creation and stored only as a SHA-256 hash. Revocable.
- **Capability-gated.** A connector carries a granted capability subset; the same gate the built-in agent uses (`toolAllowedForCapabilities`) filters the toolset. An MCP caller can never invoke a tool the granting capabilities couldn't authorize over HTTP.
- **Privilege floor.** An admin can only grant capabilities they themselves hold.
- **Managed from the admin UI:** AI workspace → **MCP** tab.

---

## Architecture

```
MCP client (Claude Code / Codex / remote agent)
        │  JSON-RPC over Streamable HTTP
        ▼
server/router.ts  →  /_instatic/mcp   (tryServeMcp)
        │
server/ai/mcp/transports/http.ts      WebStandardStreamableHTTPServerTransport (Web Request/Response)
        │
server/ai/mcp/auth.ts                 Bearer token → connector → capability set (401 + WWW-Authenticate otherwise)
        │
server/ai/mcp/server.ts               low-level SDK Server; tools filtered by capabilities
        │
server/ai/mcp/registry.ts             AiTool registry → MCP tools (TypeBox inputSchema sent verbatim as JSON Schema)
        │
executeAiTool(...) / treeService      in-process, ctx { db, userId, capabilities }
        ▼
repositories (data_rows, media) + applyTreeOperation + saveDataRowDraft
```

### Module layout — `server/ai/mcp/`

| File | Responsibility |
|---|---|
| `transports/http.ts` | Mounts the SDK's Web-standard Streamable-HTTP transport; stateless per request (`enableJsonResponse`). |
| `auth.ts` | Bearer resolution → `{ connectorId, userId, capabilities }`; spec-correct 401 with an RFC 9728 `resource_metadata` pointer. |
| `server.ts` | Builds a capability-scoped low-level `Server` (`ListTools` / `CallTool` handlers). Uses the low-level `Server`, not `McpServer.registerTool`, because the latter needs Zod (banned) — this lets the TypeBox `inputSchema` pass through verbatim. |
| `registry.ts` | The exposable toolset = every `execution: 'server'` tool, filtered by `toolAllowedForCapabilities`. |
| `tools/pageTreeTools.ts` | `read_page_tree` / `mutate_page_tree`, backed by the shared `treeService`. |
| `connectors/` | `types.ts` (server-only record), `token.ts` (generate + SHA-256 hash), `store.ts` (CRUD + `toConnectorView`). |
| `handlers/connectors.ts` | `/admin/api/ai/mcp/connectors` CRUD, gated by `ai.providers.manage`. |

The headless page-tree path (load → `applyTreeOperation` → persist) lives in `server/ai/content/treeService.ts` and is shared with the plugin RPC `cms.content.tree.mutate` — neither caller duplicates the engine. Gated by `plugin-content-tree-via-engine.test.ts`.

---

## Tool surface

MCP exposes only **server-resolved** tools (`execution: 'server'`). Browser-bridged site tools need the live editor canvas and are excluded by construction; the registry auto-includes any tool the moment it becomes headless.

- **Content (server-resolved):** the `content`-scope tools — list/read collections, entries, data rows, and media; create/update where capabilities allow.
- **Visual / structure editing:**
  - `read_page_tree({ entryId, fieldId? })` — returns the full `NodeTree`.
  - `mutate_page_tree({ entryId, fieldId?, operations[] })` — applies the 11 canonical tree operations (insert / delete / move / duplicate / wrap / rename / updateProps / setBreakpointOverride / clearBreakpointOverride / toggleNodeLocked / toggleNodeHidden) through `applyTreeOperation`, then persists a draft.

`fieldId` defaults to `body`. Pages and posts are `data_rows` whose `body` field holds the tree.

---

## Authentication

**Phase 1 — bearer token (current).** Each connector has a long-lived secret (`imcp_…`). The client sends `Authorization: Bearer <token>`. The server hashes the presented token and looks up a non-revoked connector, yielding its capability set. Missing/invalid tokens get a `401` with `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"`.

Works today with Claude Code, Cursor, Claude.ai custom connectors, and custom remote agents.

**Phase 2 — OAuth 2.1 (designed, not built).** ChatGPT and Gemini's *managed* connector UIs refuse static API keys and require an OAuth 2.1 flow conforming to the MCP authorization spec (RFC 9728 Protected Resource Metadata). The `auth_mode` column and the 401's `resource_metadata` pointer are already in place so this layers in without a migration rewrite.

---

## Connecting a client

Create a connector in **AI → MCP**, choose its type and capabilities, then copy the token (shown once).

**Local (Claude Code / Codex / Cursor):**

```sh
claude mcp add instatic --transport http http://localhost:3000/_instatic/mcp \
  --header "Authorization: Bearer imcp_…"
```

**Remote:** point the client at `https://<your-host>/_instatic/mcp` and send the token as an `Authorization: Bearer` header.

---

## Data model

`ai_mcp_connectors` (migration `018`, PG + SQLite parity):

| column | notes |
|---|---|
| `id`, `user_id`, `label` | owner + display name |
| `type` | `local` \| `remote` |
| `auth_mode` | `bearer` now; `oauth` reserved for phase 2 |
| `token_hash` | SHA-256 of the secret; never the plaintext. Unique. |
| `capabilities_json` | granted capability subset |
| `created_at`, `last_used_at`, `revoked_at` | lifecycle; revoked tokens fail auth |

The wire-safe `McpConnectorView` (the only HTTP-returned shape) never includes the hash — gated by `ai-mcp-connectors-never-leak.test.ts`. Create and revoke are audited (`ai.mcp_connector.created` / `ai.mcp_connector.revoked`).

---

## Capabilities

Connector management is gated by `ai.providers.manage` (the AI-integrations admin surface). A connector's granted capabilities flow straight into the existing tool gate:

- mutating tools require `ai.tools.write`;
- page-tree edits require any of `site.structure.edit` / `site.content.edit` / `site.style.edit` / `pages.edit`;
- reads require any site/content read grant.

An admin cannot grant a capability they do not hold (enforced in `handlers/connectors.ts`).

---

## Tests

- `server/ai/mcp/connectors/{token,store}.test.ts` — token hashing + store CRUD.
- `server/ai/content/treeService.test.ts` — headless load/mutate/persist.
- `server/ai/mcp/{registry,auth,server,transports/http}.test.ts` — capability filtering, bearer auth + 401, full MCP round-trip (list/read/mutate), HTTP handshake.
- `src/__tests__/ai/mcpConnectorsHandler.test.ts` — CRUD, privilege floor, capability gating.
- `src/__tests__/architecture/ai-mcp-connectors-never-leak.test.ts` — token never serialized.
