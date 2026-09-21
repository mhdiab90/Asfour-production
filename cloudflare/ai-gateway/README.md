# ASFOUR AI Gateway (Cloudflare Worker)

This is the secure server-side component that lets the ASFOUR ERP's AI
Assistant call real AI providers (Claude, Gemini, Cloudflare Workers AI,
OpenRouter Free) without ever putting an API key in the React/Vite frontend
bundle. The Worker code below is written to support all four, but which
secrets/bindings you actually configure determines which providers show as
`READY` vs `NOT_CONFIGURED` in the Admin AI Provider Manager screen.

**You deploy this yourself** (`wrangler deploy`) - it is not deployed as
part of writing this code. If you already deployed an earlier version of
this Worker (Claude-only), this update is backward compatible: existing
`/chat` calls without a `provider` field still default to `claude`.

## What it does

- `POST /chat` - forwards a conversation + tool definitions to the selected
  provider (`provider: "claude" | "gemini" | "cloudflare_workers_ai" |
  "openrouter"` in the request body) and returns a normalized reply: either a
  tool-call request or plain text.
- `POST /health` - a deliberately minimal, cheap live call to the selected
  provider (never called automatically by the frontend - only when an admin
  clicks "Test Connection" in the AI Provider Manager screen), returning
  `READY` / `NOT_CONFIGURED` / `UNAVAILABLE` / `ERROR` with a safe reason.

Both endpoints first verify the request carries a valid Firebase ID token
for a real, currently signed-in ASFOUR user (checked against Google's
public keys - real signature verification, not a blind decode).

It has **no knowledge of ASFOUR's data model, Firestore, or business
rules**. It never queries any database. When a model decides to call a
tool, this Worker just relays that decision; the actual permission check,
data fetch, and any write happen back in the browser through the existing
Tool Registry / Permission Guard / ERP services (`src/assistant/`), exactly
the same regardless of which provider is active.

## Deploying / updating it

Prerequisites: a Cloudflare account and Node.js. An Anthropic, Gemini, and/or
OpenRouter API key only if you want those specific providers active -
Cloudflare Workers AI needs none of them.

```bash
npm install -g wrangler
cd cloudflare/ai-gateway
cp wrangler.toml.example wrangler.toml   # skip if you already have one
```

Edit `wrangler.toml`:
- `ANTHROPIC_MODEL` / `GEMINI_MODEL` / `CLOUDFLARE_AI_MODEL` / `OPENROUTER_MODEL`
  - the exact model id per provider. Change these here, never in frontend
  code, to switch models without touching any Tool definition.
  `OPENROUTER_MODEL` defaults to `openrouter/free`, OpenRouter's dynamic
  router across whichever free models are currently available - leave it as
  the default rather than pinning a single free-model slug, since
  OpenRouter's free pool changes over time. An admin can later set an
  explicit model (e.g. `some-model:free`) here if ever needed.
- `FIREBASE_PROJECT_ID` - already defaulted to `asfourproduction-70e6e`
  (the public Firebase project id, not a secret).
- `ALLOWED_ORIGIN` - one or more exact origins your ASFOUR frontend is
  served from, comma-separated (e.g. your local dev server AND your
  deployed Firebase Hosting origin: `http://localhost:3000,https://your-project.web.app`).
  Requests from any other origin are rejected by CORS.
- The `[ai]` binding section - leave it in even if you don't plan to use
  Cloudflare Workers AI yet; it costs nothing to keep enabled.

```bash
wrangler login   # skip if already logged in
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put GEMINI_API_KEY       # optional - only if/when you want Gemini active
wrangler secret put OPENROUTER_API_KEY   # optional - only if/when you want OpenRouter Free active
wrangler deploy
```

`wrangler deploy` prints the Worker's public URL, e.g.
`https://asfour-ai-gateway.<your-subdomain>.workers.dev`.

**Cloudflare Workers AI needs no secret at all** - once the `[ai]` binding
is in `wrangler.toml` and deployed, it's immediately usable; the Admin AI
Provider Manager's "Test Connection" for it will show `READY` (or a real
error) without any extra setup.

## Wiring it into the ASFOUR frontend

Set these in the frontend's environment (`.env.local` for local dev, or your
hosting provider's environment variables for a real deployment) - **all
non-secret**, safe to expose:

```
VITE_AI_GATEWAY_URL=https://asfour-ai-gateway.<your-subdomain>.workers.dev
VITE_AI_PROVIDER=mock
```

`VITE_AI_PROVIDER` is only the **development-only fallback** used before an
admin has ever set one via the Admin AI Provider Manager screen (Firestore
`aiProviderConfig/active`) - the actual production provider is chosen there,
at runtime, without rebuilding the frontend. Rebuild/redeploy once after
setting `VITE_AI_GATEWAY_URL` so every provider adapter can reach the
gateway at all; after that, switching providers is admin-controlled and
needs no further rebuild.

## Known limitations

- **Rate limiting is minimal.** Only basic payload-size and message-count
  caps are enforced. Real per-user rate limiting needs Cloudflare KV or
  Durable Objects - add it before high-volume production use.
- **No streaming.** The frontend calls this synchronously; `streamResponse`
  falls back to a single non-streamed call for every provider.
- **JWKS cache is in-isolate only** (no KV), so a cold start re-fetches
  Google's public keys once - a normal, expected cost, not a bug.
- **Cloudflare Workers AI has been confirmed working end-to-end** (real
  responses + real tool calls against ASFOUR ERP tools). **Gemini's request/
  response wire format has also been confirmed correct** (live-verified
  against Google's real API, including auth header and error-body parsing) -
  it currently fails Test Connection only because of a Google-side project
  access restriction (`403 PERMISSION_DENIED: Your project has been denied
  access`), unrelated to anything in this Worker's code.
- **OpenRouter's wire format is written to its documented OpenAI-compatible
  request/response shape but not yet live-verified** - no working
  `OPENROUTER_API_KEY` had been tested end-to-end at the time this code was
  written. Run "Test Connection" in the Admin screen after deploying to
  confirm; if it fails, the raw error is logged server-side (`console.error`
  in the Worker, visible via `wrangler tail`) without being leaked to the
  browser or containing the API key.
- **OpenRouter Free is subject to OpenRouter's own free-tier limits**
  (documented as roughly 50 requests/day and 20 requests/minute at the time
  of writing - treat this as OpenRouter's policy, not an ASFOUR constant, and
  expect it to change). The Admin screen surfaces this as an informational
  notice, not an enforced application limit.
- **OpenRouter's free-model pool spans multiple upstream providers with
  differing data-retention/training policies.** `openrouter/free` dynamically
  picks among them per request, so ASFOUR cannot claim a single uniform data
  policy for everything routed through it - the Admin screen shows an
  explicit warning about this before an admin activates OpenRouter, rather
  than a false blanket claim that "data never leaves OpenRouter."
