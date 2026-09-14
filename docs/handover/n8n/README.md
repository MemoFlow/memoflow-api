# n8n Workflow Handover — MemoFlow Context Gathering

This is a **complete, standalone** guide for building the **RabbitMQ workflow** — the
target transport. It's written for someone building an n8n workflow who has **not** worked
with message queues before; every term is explained where it first appears.

> **One caveat on "standalone":** this covers the future RabbitMQ path only. The transport
> that's **live today** is a simple HTTP call (MemoFlow POSTs the gather request to a URL
> you host). If your team also owns that current HTTP endpoint, see the developer bundle
> `../context-engine/README.md` (§9) for what to hand back now. This guide is all you need
> for the RabbitMQ side.

Your workflow's one job: when MemoFlow asks for "context" about a user's request, go fetch
that context from the user's connected apps (Trello / Notion / GitHub via Composio) and
send it back. All of this happens through a **message queue** — explained next.

> **⚠️ Not live yet — build it, but don't expect messages today.** The MemoFlow side that
> drops requests into your mailbox **isn't finished yet**. You can build and test this
> whole workflow now (see §6 for how to test on your own), but real jobs won't start
> arriving until the MemoFlow team turns their side on. **Agree on a start date with
> them** before you rely on it.

**Files in this folder:**

| File | What it's for |
| --- | --- |
| `README.md` (this) | The whole guide — read top to bottom |
| `context-request.schema.json` | The exact shape of the message you **receive** |
| `context-result.schema.json` | The exact shape of the messages you **send** |

---

## 1. What is a message queue? (plain English)

MemoFlow and your n8n workflow never call each other directly. Instead they pass notes
through a **middleman** called **RabbitMQ** — think of it as a **post office with two
labelled mailboxes**:

- **Mailbox A — `ctx.gather.requests`**: MemoFlow drops a note here saying "please gather
  context for this job." **You read from this mailbox.**
- **Mailbox B — `ctx.gather.results`**: You drop your gathered context here. **You write to
  this mailbox.** MemoFlow empties it.

A few words you'll see:

- **Publish** = put a note in a mailbox.
- **Consume / trigger** = take the next note out of a mailbox.
- **Acknowledge (ack)** = tell the post office "I've got this one safely, you can delete
  it." Until you ack, it keeps the note — and might hand you the **same note twice** if
  something hiccups. (That's fine — see the "job_id" rule below.)
- **Exchange** = the sorting counter at the post office. You always publish to the exchange
  named `context`, with a **routing key** (a label) that tells it which mailbox to drop
  your note into.

That's the entire mental model. Now the steps.

---

## 2. What you'll receive (one note per job)

MemoFlow drops a note like this into **Mailbox A** (`ctx.gather.requests`):

```json
{
  "schema_version": 1,
  "job_id": "665f1a2b3c4d5e6f7a8b9c0d",
  "user_id": "6f9619ff-8b86-d011-b42d-00cf4fc964ff",
  "prompt": "Draft an outline for chapter 3",
  "connectors": [
    { "provider": "trello", "mcp_url": null, "composio_account_id": "ca_abc123" }
  ],
  "requested_at": "2026-07-05T12:00:00.000Z"
}
```

What each field means:

| Field | Meaning |
| --- | --- |
| `job_id` | The **ID of this job**. Write it down — you must put it on every note you send back. It's how MemoFlow matches your answer to the question. |
| `user_id` | Which user this is for. Copy it back unchanged on every note you send. |
| `prompt` | What the user is trying to do — helps you decide what context to gather. |
| `connectors` | The apps to gather from. Each has a `provider` (`trello`/`notion`/`github`) and a `composio_account_id`. If this list is **empty**, gather nothing and skip to sending the "done" note. |
| `composio_account_id` | The user's account ID inside Composio. You use it with **your** Composio key to reach that app. It is not a password. |
| `mcp_url` | Always `null` — ignore it. You find the live connection yourself using `provider` + `composio_account_id`. |

**One rule to never break:** you might receive the **same `job_id` twice** (the post
office re-hands notes if it's unsure you got them). If you've already started a job with
that `job_id`, **ignore the duplicate** — don't gather twice.

---

## 3. What you'll send back (several notes, then one "done" note)

You send notes into **Mailbox B** (`ctx.gather.results`). There are two kinds of note:

**(a) `data` notes** — one per chunk of context you gathered:
```json
{
  "schema_version": 1,
  "job_id": "665f1a2b3c4d5e6f7a8b9c0d",
  "user_id": "6f9619ff-8b86-d011-b42d-00cf4fc964ff",
  "sequence": 0,
  "type": "data",
  "data": { "provider": "trello", "content": "…the stuff you gathered…", "token_estimate": 420 }
}
```

**(b) `status` notes** — progress and, most importantly, the **final "done" note**:
```json
// optional progress note (send as many or as few as you like)
{ "schema_version": 1, "job_id": "665f…9c0d", "user_id": "6f96…64ff",
  "sequence": 1, "type": "status", "status": { "phase": "gathering", "message": "2 of 3 apps done" } }

// THE FINAL NOTE — send exactly one of these, and it must be last
{ "schema_version": 1, "job_id": "665f…9c0d", "user_id": "6f96…64ff",
  "sequence": 2, "type": "status", "status": { "phase": "completed" } }
```

Field rules — read carefully:

| Field | Rule |
| --- | --- |
| `job_id`, `user_id` | Copy them **exactly** from the note you received. |
| `schema_version` | Always `1`. |
| `sequence` | A counter. Start at **0** for your first note, then `1`, `2`, `3`… Never reuse a number, never skip backwards. |
| `type` | `"data"` for context, `"status"` for progress/done. |
| `data` | Only on `data` notes. `provider` = which app, `content` = the gathered text (any string), `token_estimate` = optional rough size. |
| `status.phase` | `"gathering"` / `"started"` = still working (optional). `"completed"` = success, done. `"failed"` = something broke, done. |

**The two rules that matter most:**

1. **Always end with exactly ONE final note** — either `phase: "completed"` or
   `phase: "failed"`. If you forget it, MemoFlow eventually gives up and marks the job
   failed on a timeout.
2. If something goes wrong, **send the `failed` note** (don't just stop silently):
   ```json
   { "schema_version": 1, "job_id": "665f…9c0d", "user_id": "6f96…64ff",
     "sequence": 3, "type": "status",
     "status": { "phase": "failed", "error_code": "MCP_UNREACHABLE", "message": "Trello timed out" } }
   ```

---

## 4. Building the workflow in n8n — step by step

### Step 0 — Connection details you need (ask the MemoFlow team)
- The **RabbitMQ connection string**: looks like
  `amqps://username:password@host/vhost` (the `amqps://` means it's encrypted — good).
- Confirm **who creates the mailboxes**. Normally MemoFlow creates them; you just connect.
- Your **Composio API key** (from your own Composio account).

Add the RabbitMQ credentials in n8n under **Credentials → RabbitMQ**.

### Step 1 — Receive requests
1. Add a **RabbitMQ Trigger** node.
2. Set **Queue** to exactly: `ctx.gather.requests`
3. Set **Acknowledge** to **"Manually"** (so a note isn't deleted until you're done).
4. Set **Prefetch** (a.k.a. concurrency) to something small like `1` to `10` — this limits
   how many jobs run at once.

### Step 2 — Skip duplicates
1. Read `job_id` from the incoming note.
2. Keep a list of `job_id`s you've already started (n8n static data, a database, or a
   Redis Set). If this `job_id` is already there, **stop** — it's a duplicate.

### Step 3 — Gather the context
1. For each item in `connectors`: use its `provider` + `composio_account_id` **with your
   Composio key** to reach that app's live connection, then fetch the relevant info.
2. Collect the results.

### Step 4 — Send the results
1. Add a **RabbitMQ** (producer) node for each note you publish.
2. Set **Exchange** to: `context`
3. Set **Routing Key** to: `ctx.gather.result`
4. Turn on **persistent / durable delivery** if the option is shown.
5. In the message options set **correlation id** to the job's `job_id`.
6. Send your `data` notes first (sequence `0`, `1`, …), then **one** final `status` note
   (`completed` or `failed`).

### Step 5 — Acknowledge
1. After you've sent the final note, **ack** the original request (in the Trigger node
   settings / a downstream node) so the post office deletes it.
2. If the incoming note was **garbage** (unreadable / fails the schema), **reject it
   without requeue** ("nack, no requeue") so it goes to the reject pile
   (`ctx.gather.requests.dlq`) instead of coming back forever.

---

## 5. The exact names — copy these letter-for-letter

One typo and nothing works. Copy from here:

| Setting | Value |
| --- | --- |
| Exchange | `context` |
| Queue you READ from | `ctx.gather.requests` |
| Queue you WRITE to | `ctx.gather.results` |
| Routing key when you publish | `ctx.gather.result` |
| Reject pile (dead-letter) | `ctx.gather.requests.dlq` |

---

## 6. Test it before going live

1. Ask the MemoFlow team to send a **test request** into `ctx.gather.requests` (or send one
   yourself with a RabbitMQ tool).
2. Confirm your workflow wakes up and reads it.
3. Send back one `data` note and one `completed` note.
4. Ask the MemoFlow team to confirm they saw both, and that the job was marked completed.
5. Try a **broken** message and confirm it lands in the reject pile, not a loop.

If you want to validate your outgoing notes automatically, n8n has a JSON-schema validate
step — point it at `context-result.schema.json` in this folder.

---

## 7. Final checklist

- [ ] RabbitMQ credentials added in n8n; connection works.
- [ ] Trigger node on `ctx.gather.requests`, **manual** acknowledge, small prefetch.
- [ ] Duplicate `job_id`s are ignored.
- [ ] Composio key reaches each user's app from `provider` + `composio_account_id`.
- [ ] Results published to exchange `context`, routing key `ctx.gather.result`,
      `job_id` + `user_id` copied exactly, `schema_version: 1`.
- [ ] Notes numbered with `sequence` starting at 0, increasing.
- [ ] **Exactly one** final `status` note (`completed` or `failed`) at the end — always.
- [ ] Failures send a `failed` note with an `error_code`; broken incoming messages go to
      the reject pile.

---

---

## 8. What to tell the MemoFlow team back

Once your workflow is built, send them:

- **"Composio is ready."** Confirm your Composio account can reach the **same connected
  apps** MemoFlow set up — so when you get a `composio_account_id`, you can actually open
  that user's app. (Without this, every job fails.)
- **Who makes the mailboxes.** Agree who creates the RabbitMQ exchange + queues (§5 names).
  Easiest: let the MemoFlow team create them and you just connect. Confirm which.
- **The broker address**, *if* you (or your infra person) own the RabbitMQ server — the
  `amqps://…` connection string. If MemoFlow owns it, they give it to you instead.
- **"It's tested."** Tell them when you've run the test in §6 successfully, and agree a
  **go-live date** — real jobs only start once both sides flip on.

---

> **Before go-live:** coordinate the RabbitMQ connection string and timing with the
> MemoFlow team. Their side is built to match these two schema files — as long as your
> notes match them, it works.
