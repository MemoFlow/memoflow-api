# Context-Engine Gathering Guide

You are the **gathering brains**. The **n8n team** owns the RabbitMQ transport and
orchestration (see [`n8n-guide.md`](./n8n-guide.md)); they invoke you **per connector** to
do the actual work — resolve the MCP and gather context. You do **not** touch RabbitMQ, the
MemoFlow API, or the frontend. This guide specs what you receive and what you return so the
content fits the MemoFlow wire contract
([`../contracts/context-engine.md`](../contracts/context-engine.md)).

```
MemoFlow API --RabbitMQ--> n8n (transport + orchestration)
                              │  per connector: invoke you ↓
                              └─────▶ context engine (you): resolve MCP + gather
                              ◀───── return gathered content
n8n --RabbitMQ--> MemoFlow API --WebSocket--> browser
```

## 1. Your role

For each active connector on a planning job, n8n hands you three things and expects the
gathered content back:

- **Receive:** `provider` (`trello | notion | github`), `composio_account_id`, and the
  user's `prompt`.
- **Do:** resolve the live MCP server for that provider from `composio_account_id` (using
  **your own Composio credentials**), run the MCP agent (e.g. a Trello agent → Composio's
  Trello MCP), and gather the relevant context for the prompt.
- **Return:** the gathered content for that connector (to n8n, over your agreed protocol).

The **n8n↔you** protocol (HTTP call, sub-workflow, your own queue…) is between your two
teams — it is **not** part of the MemoFlow contract. This guide only pins the **data
shapes** so what you produce slots into n8n's result chunks.

## 2. Prerequisites

- **Composio API key** with access to the same connected accounts the MemoFlow API created
  — this is how you turn a `composio_account_id` into a live MCP. MemoFlow never sends you
  provider OAuth tokens (Composio is the vault); `composio_account_id` is an id, not a
  secret.
- **MCP agent runtime** for each provider you support.

## 3. Input (per connector)

n8n forwards these fields (a subset of the MemoFlow gather request — full schema:
[`../contracts/context-request.schema.json`](../contracts/context-request.schema.json)):

| Field | Meaning |
| --- | --- |
| `provider` | `trello` \| `notion` \| `github` — which MCP agent to run |
| `composio_account_id` | Composio connected-account id — resolve the live MCP from this + your Composio key |
| `prompt` | The user's planning prompt — what to gather for |

`mcp_url` is deliberately **`null`** in the request — you resolve the real MCP endpoint
yourself; do not expect MemoFlow to supply it.

## 4. Output (per connector)

Return, for each connector, the payload that becomes a result **`data` chunk**. Shape it to
[`../contracts/context-result.schema.json`](../contracts/context-result.schema.json)'s
`data` object so n8n can forward it verbatim:

```json
{
  "provider": "trello",
  "content": "{…gathered context — a JSON string or text blob…}",
  "token_estimate": 420
}
```

- `content` is **opaque to MemoFlow** — it's consumed later by the LLM planner (roadmap
  item 5). Pack whatever the planner needs (cards, pages, issues, summaries…) as a JSON
  string or text.
- `token_estimate` is optional but helps downstream budgeting.
- n8n wraps each of these into a sequenced `data` chunk and adds the terminal `status`
  chunk — **you don't set `sequence`, `job_id`, `user_id`, or emit the terminal status**;
  that's transport, which is n8n's job.

## 5. Errors

If you can't gather a connector (MCP unreachable, Composio account inactive, agent
failure), **signal n8n** over your agreed protocol with a clear error — do not return
partial-but-silent content. n8n decides whether to emit a partial result or a terminal
`failed` status to MemoFlow; the terminal signal is transport, not yours.

## 6. Non-goals

- **Transport** (RabbitMQ, chunk sequencing, terminal status) — n8n owns it.
- **The n8n↔you protocol** — you and the n8n team define it.
- **The LLM planner** — MemoFlow roadmap item 5 consumes your `content`; out of scope here.

> Full picture (both hops, lifecycle, versioning):
> [`../contracts/context-engine.md`](../contracts/context-engine.md).
