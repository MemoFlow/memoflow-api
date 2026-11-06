# MemoFlow AI Data Notice

> **DRAFT. Requires legal review before use. This is not legal advice and is not yet
> approved for users.** Do not show it to users, or treat acceptance of it as valid
> consent, until the owner has had it reviewed and the items under
> [To confirm before publishing](#to-confirm-before-publishing) are resolved.

**Notice version: `2026-11-06`.** This must equal `AI_NOTICE_VERSION` in
`src/domain/ai/ai-consent.ts`. Whenever the published text changes in a way that matters
to users, bump that constant: every user then has to accept again (the API treats consent
for an older version as missing). The bump and the text change ship in the same PR.

This notice will need a French version: MemoFlow's users and templates are French. The
French text must carry the same version string.

The text below is addressed to the end user and is the draft of what the frontend would
show before the user turns on AI features.

---

## AI features in MemoFlow

MemoFlow has AI features: suggestions for a section of your document (rewrite, summarize,
expand and similar) and planning help, which proposes an outline and ideas for your work.
They are optional. You can use MemoFlow without them. You only get them if you agree to
this notice.

### You can change your mind

You can withdraw your agreement at any time in your settings. Once you do, MemoFlow stops
sending new content to AI. Withdrawing does not delete suggestions or planning results
you already received; they stay in your account.

### What is sent to the AI model

- **Suggestions.** The text of the section you ask about, together with the title of the
  document and the titles of the sections just before and after it.
- **Planning.** Your request, plus up to 8 of your sections (each cut to 4000 characters
  at most). These are sections that match your request, including sections from your
  other documents, and sections from the document you linked to the request, even if
  they don't match. If you selected connected apps, content gathered from them is sent
  too.

Only your own sections are used.

### Where it goes

Your content is sent to OpenRouter, a service that passes it on to third-party AI model
providers. MemoFlow currently uses free models. The providers of free models may keep a
record of what they receive and the replies, and may use them to train their models.

**Do not submit sensitive or confidential information** (for example passwords, health
details, other people's personal data, or confidential work material) to the AI features.

MemoFlow tries to remove secrets such as keys and tokens from the text before it is sent.
This automatic redaction is best effort and can miss things. Do not rely on it.

### Replies can be wrong

AI replies can be inaccurate, incomplete or invented, including made-up sources or facts.
Read and check every suggestion before you use it.

### What MemoFlow stores

- The suggestions and planning results you get, and, for each suggestion, the text of the
  original section it was based on.
- A temporary copy of suggestion text, kept for up to 24 hours so that an identical
  request can be answered quickly. This copy cannot be removed per user: if your account
  is deleted, it remains until it expires.
- Your planning requests, and any content gathered from connected apps for them.
- Information about which of your sections were used for a planning result (their titles
  and identifiers, not their text).
- A record that you accepted this notice: when, and which version.

### Usage limits

There is a daily limit on AI use per person and a shared daily limit across all users.
When a limit is reached you have to wait until the next day.

---

## To confirm before publishing

These are decisions or facts the code cannot establish. Do not publish until each is
settled and the notice text above is updated to match.

| Item | Status |
| --- | --- |
| Identity and contact details of the data controller | Not stated anywhere in the repo. Needs the owner. |
| Legal basis for AI processing (consent is collected, but whether it is the right and sufficient basis, and whether it must be separate from other consents, is a legal question) | Needs legal review. |
| International transfers (OpenRouter and the upstream providers may be outside the user's country; what safeguards apply) | Needs legal review; providers' locations unverified. |
| Process for exercising data subject rights (access, correction, deletion, objection, withdrawal) and how to reach it | Undefined. There is no self-service account deletion today (see `docs/privacy-data-inventory.md`, section 5). |
| Retention periods for suggestions, planning jobs, versions and audit rows | Undefined. The code applies no retention rules except the 24-hour cache expiry (configurable, `AI_CACHE_TTL_SECONDS`). |
| Exact list of model providers and their terms | Unknown: `openrouter/free` routes to whichever free provider serves the request. Name them, or say how users can find out. |
| Whether the notice must name the sub-processors that host the data (hosting, databases, cache) | Needs legal review; see `docs/privacy-data-inventory.md`, section 3. |
| French translation | To be produced and reviewed with the same version string. |
| Whether the 24-hour cache description stays accurate if `AI_CACHE_TTL_SECONDS` is changed | Update the text if the default changes. |

## Related docs

- [`docs/privacy-data-inventory.md`](privacy-data-inventory.md): internal fact base this
  draft is checked against.
- [`docs/integration/frontend-guide.md`](integration/frontend-guide.md): how the frontend
  presents the notice and records acceptance.
- [`docs/security.md`](security.md): AI consent enforcement.
