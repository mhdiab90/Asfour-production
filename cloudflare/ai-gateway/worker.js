/**
 * ASFOUR AI Gateway - Cloudflare Worker
 *
 * The ONLY place ANTHROPIC_API_KEY / GEMINI_API_KEY exist. The React/Vite
 * frontend never sees either key - it only knows this Worker's public URL
 * (VITE_AI_GATEWAY_URL, a non-secret endpoint address). Cloudflare Workers
 * AI needs NO separate key at all - it runs through the native `env.AI`
 * binding, authenticated simply by running inside this same Cloudflare
 * account (see wrangler.toml's [ai] binding).
 *
 * Architecture boundary (do not weaken without a real security review):
 *   ASFOUR React app --HTTPS, Firebase ID token--> this Worker
 *     --HTTPS, provider API key (or native binding)--> Claude / Gemini / Workers AI
 *
 * This Worker is a thin, honest proxy - one per supported provider, picked
 * by the `provider` field the frontend sends. It knows NOTHING about
 * ASFOUR's ERP data model, Firestore, or business rules - it never queries
 * any database and never executes a "tool" itself. When the model decides
 * to call a tool, this Worker hands that decision straight back to the
 * browser; the browser's existing Tool Registry / Permission Guard / ERP
 * services (src/assistant/) do the actual permission check, data fetch,
 * and any write - exactly as they do for MockProvider today, regardless of
 * which provider is active. This Worker cannot read Firestore, cannot
 * bypass ASFOUR permissions, and holds no Firebase Admin/GitHub/Cloudflare
 * deploy credential of any kind.
 *
 * Every request must carry a valid Firebase ID token for an ASFOUR user
 * (Authorization: Bearer <idToken>), verified below against Google's public
 * keys. Without this, anyone who discovered the Worker URL could relay
 * unlimited requests onto ASFOUR's paid provider accounts.
 */

// ---------------------------------------------------------------------------
// Config read from Worker environment (set via `wrangler secret put` / vars
// / bindings - never committed to this repo, see wrangler.toml.example and
// README.md).
// ---------------------------------------------------------------------------
// env.ANTHROPIC_API_KEY   (secret)  - Claude API key
// env.ANTHROPIC_MODEL     (var)     - e.g. "claude-sonnet-4-5-20250929"
// env.GEMINI_API_KEY      (secret, optional) - Gemini API key; unset = NOT_CONFIGURED
// env.GEMINI_MODEL        (var)     - e.g. "gemini-2.0-flash"
// env.AI                  (binding) - Cloudflare Workers AI native binding; no key needed
// env.CLOUDFLARE_AI_MODEL (var)     - e.g. "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
// env.OPENROUTER_API_KEY  (secret, optional) - OpenRouter API key; unset = NOT_CONFIGURED
// env.OPENROUTER_MODEL    (var)     - e.g. "openrouter/free" (OpenRouter's dynamic free-model router)
// env.FIREBASE_PROJECT_ID (var)     - e.g. "asfourproduction-70e6e" (public, not secret)
// env.ALLOWED_ORIGIN      (var)     - one or more ASFOUR frontend origins
//                                     this Worker accepts requests from, comma-
//                                     separated (no spaces needed - trimmed),
//                                     e.g. "http://localhost:3000,https://asfourproduction-70e6e.web.app".
//                                     Each entry must be an EXACT origin
//                                     (scheme + host + port) - never "*".

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_CLOUDFLARE_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
// gemini-2.0-flash was shut down 2026-06-01; gemini-3.6-flash confirmed
// current via Google's own model docs at the time of this change. generateContent
// (this file's existing implementation) remains fully supported for Gemini 3.x -
// no API migration to /v1beta/interactions was needed or made.
const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';
// OpenRouter's dynamic free-model router - picks among whichever free models
// are currently available and filters for the capabilities a request needs
// (tool calling, structured output). Never hardcode a single free-model slug
// as the default - OpenRouter's free pool changes over time.
const DEFAULT_OPENROUTER_MODEL = 'openrouter/free';
const MAX_TOKENS = 1024;
const MAX_MESSAGES = 40;
const MAX_TOOLS = 60;
const MAX_BODY_BYTES = 200_000;
const VALID_PROVIDERS = new Set(['claude', 'gemini', 'cloudflare_workers_ai', 'openrouter']);

// Fix for the live Vietnamese-response regression: the system prompt sent by
// the client (src/assistant/providers/promptBuilder.ts) already assembles
// CRITICAL REQUEST CONTEXT (language/date/page/provider) FIRST and self-
// limits to that same file's MAX_SYSTEM_PROMPT_CHARS - so this Worker-side
// cap should essentially never fire in normal operation. It still exists as
// a defense-in-depth backstop against any oversized system prompt reaching
// a specific provider call (e.g. a future bug, or a client build that
// predates the client-side limit). MUST be kept equal to promptBuilder.ts's
// MAX_SYSTEM_PROMPT_CHARS - same reasoning duplicated there (this Worker is
// a separate runtime/deploy and cannot import that module): Cloudflare
// Workers AI's own @cf/meta/llama-3.3-70b-instruct-fp8-fast model has the
// TIGHTEST real context window of the 4 real providers at 24,000 tokens
// (Cloudflare's own docs) vs Claude/Gemini/OpenRouter's 200K+, and 16,000
// characters (~5,300 tokens at a conservative ~3 chars/token for mixed
// Arabic/English text) leaves ample room under that ceiling for tool
// schemas, conversation history, and the MAX_TOKENS response budget.
//
// Previously this was a blind `.slice(0, 8000)` duplicated across all 4
// provider call functions - since the client used to append its critical
// context (language/date/page) AFTER the instruction block instead of
// before it, any prompt over ~8000 characters silently lost that trailing
// context. The client-side reorder (critical context first) is the primary
// fix; raising and centralizing this constant is the second, independent
// layer, so neither side alone is a single point of failure.
const MAX_SYSTEM_PROMPT_CHARS = 16000;

/** The ONE place every provider call function truncates the system prompt - never call .slice() on `system` directly elsewhere. */
function safeSystemPrompt(system) {
  return String(system || '').slice(0, MAX_SYSTEM_PROMPT_CHARS);
}

// In-isolate cache for Google's public JWKS - real network fetches only
// happen once per cold start (or after the cache TTL elapses), not per
// request. Cloudflare Workers isolates are ephemeral, so this is a
// best-effort optimization, not a correctness dependency.
let jwksCache = { keys: null, expiresAt: 0 };

/**
 * Production Hosting AI Gateway Fix - ALLOWED_ORIGIN now holds a
 * comma-separated list of exact origins (e.g. the local dev server AND the
 * deployed Firebase Hosting origin), not a single string. Still a fixed,
 * explicit allowlist - never "*", never an arbitrary/reflected origin.
 */
function parseAllowedOrigins(allowedOriginConfig) {
  return String(allowedOriginConfig || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/** A requesting origin is only ever echoed back if it EXACTLY matches one entry in the allowlist; any other origin gets the first configured allowed origin instead (which will mismatch in the browser and be correctly rejected by CORS, exactly like before this change for a truly unknown origin). */
function corsHeaders(origin, allowedOriginConfig) {
  const allowedList = parseAllowedOrigins(allowedOriginConfig);
  const allowOrigin = allowedList.includes(origin) ? origin : (allowedList[0] || '');
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function jsonResponse(body, status, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
  });
}

// ---------------------------------------------------------------------------
// Firebase ID token verification (RS256, Google's rotating public keys).
// This is real signature verification via Web Crypto, not a blind decode -
// an attacker cannot forge a token just by knowing this is a Firebase
// project, and an expired/foreign-project token is rejected.
// ---------------------------------------------------------------------------

function base64UrlToUint8Array(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64UrlDecodeJson(b64url) {
  const bytes = base64UrlToUint8Array(b64url);
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function fetchGoogleJwks() {
  const now = Date.now();
  if (jwksCache.keys && jwksCache.expiresAt > now) return jwksCache.keys;

  const res = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  if (!res.ok) throw new Error('Unable to fetch Google public keys');
  const jwks = await res.json();

  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const ttlMs = maxAgeMatch ? Math.min(Number(maxAgeMatch[1]) * 1000, 6 * 3600_000) : 3600_000;

  jwksCache = { keys: jwks.keys, expiresAt: now + ttlMs };
  return jwks.keys;
}

/**
 * Verifies a Firebase Auth ID token belongs to a real, currently signed-in
 * ASFOUR user of this exact Firebase project. Returns the token's uid on
 * success, or throws with a safe (non-leaking) message on any failure.
 */
async function verifyFirebaseIdToken(idToken, firebaseProjectId) {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');

  const header = base64UrlDecodeJson(parts[0]);
  const payload = base64UrlDecodeJson(parts[1]);

  if (header.alg !== 'RS256') throw new Error('Unexpected token algorithm');

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) throw new Error('Token expired');
  if (typeof payload.iat !== 'number' || payload.iat > nowSeconds + 60) throw new Error('Token not yet valid');
  if (payload.aud !== firebaseProjectId) throw new Error('Token audience mismatch');
  if (payload.iss !== `https://securetoken.google.com/${firebaseProjectId}`) throw new Error('Token issuer mismatch');
  if (!payload.sub || typeof payload.sub !== 'string') throw new Error('Token missing subject');

  const keys = await fetchGoogleJwks();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('Unknown signing key');

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const signedData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = base64UrlToUint8Array(parts[2]);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signature, signedData);
  if (!valid) throw new Error('Invalid token signature');

  return { uid: payload.sub, email: payload.email || null };
}

// ---------------------------------------------------------------------------
// Provider-specific thin proxies. Each one only ever: builds the upstream
// request from {system, messages, tools}, calls that provider's real API
// (or native binding), and normalizes the reply to the SAME shape:
//   { type: 'tool_use', toolName, arguments } | { type: 'text', text }
// No ERP knowledge lives in any of these functions.
// ---------------------------------------------------------------------------

class ProviderError extends Error {
  constructor(message, kind, meta) {
    super(message);
    // 'NOT_CONFIGURED' | 'AUTH' | 'INVALID_REQUEST' | 'NOT_FOUND' |
    // 'RATE_LIMIT' | 'SERVICE_UNAVAILABLE' | 'QUOTA_EXHAUSTED' | 'OTHER'
    this.kind = kind;
    // Structured, secret-free diagnostic fields for server-side logging only -
    // never derived from or containing the API key/Authorization header.
    this.httpStatus = meta?.httpStatus;
    this.googleStatus = meta?.googleStatus;
  }
}

function classifyHttpFailure(status) {
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 429) return 'RATE_LIMIT';
  if (status >= 500) return 'SERVICE_UNAVAILABLE';
  return 'OTHER';
}

/**
 * Gemini-specific classification. Google's Generative Language API frequently
 * returns HTTP 400 for what other APIs would call 401/403 (e.g. an invalid/
 * rejected API key comes back as 400 with a structured body like
 * {"error":{"code":400,"status":"UNAUTHENTICATED" or "PERMISSION_DENIED", ...}}).
 * Relying on the raw HTTP status alone (classifyHttpFailure, still used
 * as-is for Claude) would mis-file that as a generic 'OTHER' error and hide
 * a real credential problem - so this parses Google's own structured
 * "status" field first, and only falls back to HTTP-status-based
 * classification if the body isn't the expected shape.
 */
function classifyGeminiFailure(httpStatus, errorBodyText) {
  let googleStatus = null;
  let googleMessage = null;
  try {
    const parsed = JSON.parse(errorBodyText);
    googleStatus = parsed?.error?.status || null;
    googleMessage = parsed?.error?.message || null;
  } catch {
    // Not a JSON error body - fall through to HTTP-status-only classification.
  }

  let kind;
  if (googleStatus === 'UNAUTHENTICATED' || googleStatus === 'PERMISSION_DENIED') kind = 'AUTH';
  else if (googleStatus === 'INVALID_ARGUMENT') kind = 'INVALID_REQUEST';
  else if (googleStatus === 'NOT_FOUND') kind = 'NOT_FOUND';
  else if (googleStatus === 'RESOURCE_EXHAUSTED') kind = 'RATE_LIMIT';
  else if (googleStatus === 'UNAVAILABLE' || googleStatus === 'INTERNAL') kind = 'SERVICE_UNAVAILABLE';
  else if (httpStatus === 401 || httpStatus === 403) kind = 'AUTH';
  else if (httpStatus === 400) kind = 'INVALID_REQUEST';
  else if (httpStatus === 404) kind = 'NOT_FOUND';
  else if (httpStatus === 429) kind = 'RATE_LIMIT';
  else if (httpStatus >= 500) kind = 'SERVICE_UNAVAILABLE';
  else kind = 'OTHER';

  return { kind, googleStatus, googleMessage };
}

async function callAnthropic(env, { system, messages, tools, maxTokens }) {
  if (!env.ANTHROPIC_API_KEY) throw new ProviderError('Claude is not configured', 'NOT_CONFIGURED');

  const body = {
    model: env.ANTHROPIC_MODEL,
    max_tokens: maxTokens || MAX_TOKENS,
    system: safeSystemPrompt(system),
    messages: messages.map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 4000) })),
  };
  if (tools && tools.length > 0) {
    body.tools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema || { type: 'object', properties: {} },
    }));
  }

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new ProviderError(`Anthropic API error (${res.status}): ${errText.slice(0, 300)}`, classifyHttpFailure(res.status));
  }

  const data = await res.json();
  const toolUseBlock = (data.content || []).find((b) => b.type === 'tool_use');
  if (toolUseBlock) {
    return { type: 'tool_use', toolName: toolUseBlock.name, arguments: toolUseBlock.input || {}, model: data.model };
  }
  const textBlocks = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text);
  return { type: 'text', text: textBlocks.join('\n').trim(), model: data.model };
}

/** Gemini's function-calling Schema object uses UPPERCASE type names (STRING/OBJECT/...), unlike JSON Schema. */
function toGeminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  if (schema.type) out.type = String(schema.type).toUpperCase();
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.properties) {
    out.properties = {};
    for (const [k, v] of Object.entries(schema.properties)) out.properties[k] = toGeminiSchema(v);
  }
  if (schema.items) out.items = toGeminiSchema(schema.items);
  if (Array.isArray(schema.required) && schema.required.length > 0) out.required = schema.required;
  return out;
}

async function callGemini(env, { system, messages, tools, maxTokens }) {
  if (!env.GEMINI_API_KEY) throw new ProviderError('Gemini is not configured', 'NOT_CONFIGURED');

  const model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const body = {
    systemInstruction: { parts: [{ text: safeSystemPrompt(system) }] },
    contents: messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content || '').slice(0, 4000) }],
    })),
    generationConfig: { maxOutputTokens: maxTokens || MAX_TOKENS },
  };
  if (tools && tools.length > 0) {
    body.tools = [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: toGeminiSchema(t.input_schema || { type: 'object', properties: {} }),
        })),
      },
    ];
  }

  // Auth via the x-goog-api-key header, per Google's current documented
  // method - never in the URL query string (a query-param key can end up in
  // server access logs, browser history if ever opened directly, or
  // Referer headers; the header does not).
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const { kind, googleStatus, googleMessage } = classifyGeminiFailure(res.status, errText);
    const safeDetail = (googleMessage || errText).slice(0, 300);
    throw new ProviderError(`Gemini API error (${res.status}): ${safeDetail}`, kind, { httpStatus: res.status, googleStatus });
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const functionCallPart = parts.find((p) => p.functionCall);
  if (functionCallPart) {
    return { type: 'tool_use', toolName: functionCallPart.functionCall.name, arguments: functionCallPart.functionCall.args || {}, model };
  }
  const text = parts.filter((p) => typeof p.text === 'string').map((p) => p.text).join('\n').trim();
  return { type: 'text', text, model };
}

/**
 * Consolidated UX pass Item 5 - Cloudflare Workers AI's own daily free
 * Workers AI neuron-quota exhaustion (documented error code 4006, "You have
 * exceeded the free tier limit"/daily allocation exhausted) is an
 * ACCOUNT-LEVEL resource limit, not an ERP application defect. It must be
 * distinguished from a generic binding/runtime failure so the Admin screen
 * and any live chat request can tell the user "the free quota ran out, the
 * app itself still works" instead of a scary undifferentiated error.
 * Matched broadly (code + several known phrasings) rather than one exact
 * string, since env.AI.run()'s thrown error text is not a stable, documented
 * wire contract the way an HTTP status code is.
 */
function classifyCloudflareWorkersAiFailure(errMessage) {
  const msg = String(errMessage || '');
  if (
    /\b4006\b/.test(msg) ||
    /daily\s+(free\s+)?(allocation|limit|quota)/i.test(msg) ||
    /neuron/i.test(msg) ||
    /exceeded.*(free\s+tier|quota|capacity|allocation)/i.test(msg)
  ) {
    return 'QUOTA_EXHAUSTED';
  }
  return 'OTHER';
}

async function callCloudflareWorkersAI(env, { system, messages, tools, maxTokens }) {
  if (!env.AI) throw new ProviderError('Cloudflare Workers AI binding is not configured', 'NOT_CONFIGURED');

  const model = env.CLOUDFLARE_AI_MODEL || DEFAULT_CLOUDFLARE_AI_MODEL;
  const aiMessages = [
    { role: 'system', content: safeSystemPrompt(system) },
    ...messages.map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 4000) })),
  ];
  const requestBody = { messages: aiMessages, max_tokens: maxTokens || MAX_TOKENS };
  if (tools && tools.length > 0) {
    requestBody.tools = tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema || { type: 'object', properties: {} } },
    }));
  }

  let result;
  try {
    result = await env.AI.run(model, requestBody);
  } catch (err) {
    const rawMessage = String(err?.message || err);
    throw new ProviderError(`Cloudflare Workers AI error: ${rawMessage.slice(0, 300)}`, classifyCloudflareWorkersAiFailure(rawMessage));
  }

  if (result?.tool_calls && result.tool_calls.length > 0) {
    const call = result.tool_calls[0];
    let args = call.arguments;
    if (typeof args === 'string') {
      try { args = JSON.parse(args); } catch { args = {}; }
    }
    return { type: 'tool_use', toolName: call.name, arguments: args || {}, model };
  }
  return { type: 'text', text: String(result?.response || '').trim(), model };
}

/**
 * OpenRouter-specific classification. OpenRouter is OpenAI-compatible and
 * returns errors as {"error":{"message":"...","code":<http status or string>}}.
 * HTTP status is the reliable signal (documented, stable); the body's own
 * message/code is layered on top for a safer, more specific reason string
 * when present - mirrors classifyGeminiFailure()'s "parse structured body
 * first, fall back to HTTP status" pattern.
 */
function classifyOpenRouterFailure(httpStatus, errorBodyText) {
  let openRouterMessage = null;
  try {
    const parsed = JSON.parse(errorBodyText);
    openRouterMessage = parsed?.error?.message || null;
  } catch {
    // Not a JSON error body - HTTP-status-only classification below.
  }

  let kind;
  if (httpStatus === 401 || httpStatus === 403) kind = 'AUTH';
  else if (httpStatus === 400) kind = 'INVALID_REQUEST';
  else if (httpStatus === 404) kind = 'NOT_FOUND';
  else if (httpStatus === 429) kind = 'RATE_LIMIT';
  else if (httpStatus >= 500) kind = 'SERVICE_UNAVAILABLE';
  else kind = 'OTHER';

  return { kind, openRouterMessage };
}

/**
 * OpenRouter Free - OpenAI-compatible chat completions API. Same normalized
 * {type:'tool_use'|'text', ...} contract as every other provider function -
 * the frontend AIProvider adapters never know the wire format differs.
 */
async function callOpenRouter(env, { system, messages, tools, maxTokens }) {
  if (!env.OPENROUTER_API_KEY) throw new ProviderError('OpenRouter is not configured', 'NOT_CONFIGURED');

  const model = env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
  const chatMessages = [
    { role: 'system', content: safeSystemPrompt(system) },
    ...messages.map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 4000) })),
  ];
  const body = { model, messages: chatMessages, max_tokens: maxTokens || MAX_TOKENS };
  if (tools && tools.length > 0) {
    body.tools = tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema || { type: 'object', properties: {} } },
    }));
  }

  const res = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Bearer token, never in the URL - per OpenRouter's documented auth method.
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      // Safe, non-sensitive request-identification headers OpenRouter documents
      // as optional (used for their own routing/analytics) - never anything
      // ASFOUR-user- or ASFOUR-data-specific.
      'HTTP-Referer': parseAllowedOrigins(env.ALLOWED_ORIGIN)[0] || 'https://asfour-ai-gateway.workers.dev',
      'X-Title': 'ASFOUR ERP AI',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const { kind, openRouterMessage } = classifyOpenRouterFailure(res.status, errText);
    const safeDetail = (openRouterMessage || errText).slice(0, 300);
    throw new ProviderError(`OpenRouter API error (${res.status}): ${safeDetail}`, kind, { httpStatus: res.status });
  }

  const data = await res.json();
  const choice = data?.choices?.[0];
  const toolCall = choice?.message?.tool_calls?.[0];
  if (toolCall?.function) {
    let args = toolCall.function.arguments;
    if (typeof args === 'string') {
      try { args = JSON.parse(args); } catch { args = {}; }
    }
    return { type: 'tool_use', toolName: toolCall.function.name, arguments: args || {}, model: data.model || model };
  }
  const text = String(choice?.message?.content || '').trim();
  return { type: 'text', text, model: data.model || model };
}

async function callProvider(env, provider, args) {
  if (provider === 'claude') return callAnthropic(env, args);
  if (provider === 'gemini') return callGemini(env, args);
  if (provider === 'cloudflare_workers_ai') return callCloudflareWorkersAI(env, args);
  if (provider === 'openrouter') return callOpenRouter(env, args);
  throw new ProviderError(`Unknown provider: ${provider}`, 'OTHER');
}

function healthResultFromError(err) {
  if (err instanceof ProviderError) {
    if (err.kind === 'NOT_CONFIGURED') return { status: 'NOT_CONFIGURED', reasonEn: err.message, reasonAr: 'المزود غير مُهيأ.' };
    if (err.kind === 'AUTH') {
      return {
        status: 'ERROR',
        reasonEn: 'Authentication failed - the API key was rejected. Check the credential configuration (e.g. key type/validity).',
        reasonAr: 'فشل التحقق من بيانات الاعتماد - تم رفض المفتاح. تحقق من إعداد بيانات الاعتماد (نوع/صلاحية المفتاح).',
      };
    }
    if (err.kind === 'INVALID_REQUEST') {
      return {
        status: 'ERROR',
        reasonEn: `The request was rejected as invalid: ${err.message}`,
        reasonAr: 'تم رفض الطلب لعدم صحته.',
      };
    }
    if (err.kind === 'NOT_FOUND') {
      return {
        status: 'ERROR',
        reasonEn: 'The configured model was not found for this account/key - check the model id.',
        reasonAr: 'النموذج المُهيأ غير موجود لهذا الحساب/المفتاح - تحقق من معرّف النموذج.',
      };
    }
    if (err.kind === 'RATE_LIMIT') return { status: 'UNAVAILABLE', reasonEn: 'Rate limited or quota exceeded.', reasonAr: 'تم تجاوز الحد المسموح أو نفاد الرصيد.' };
    if (err.kind === 'SERVICE_UNAVAILABLE') return { status: 'UNAVAILABLE', reasonEn: 'The provider service is currently unavailable.', reasonAr: 'خدمة المزود غير متاحة حالياً.' };
    // Consolidated UX pass Item 5 - an account-level free-tier exhaustion
    // (e.g. Cloudflare Workers AI's daily neuron quota, error 4006), never a
    // generic ERROR: the ERP application itself is fine, only this
    // provider's free allocation is temporarily used up.
    if (err.kind === 'QUOTA_EXHAUSTED') {
      return {
        status: 'QUOTA_EXHAUSTED',
        reasonEn: 'The free quota currently available for this AI provider has run out. The application itself is working fine - you can switch to another provider or try again once the quota resets.',
        reasonAr: 'انتهت الحصة المجانية المتاحة لمزود الذكاء الاصطناعي حاليًا. البرنامج نفسه يعمل، ويمكنك استخدام مزود آخر أو المحاولة مرة أخرى بعد تجدد الحصة.',
      };
    }
  }
  return { status: 'ERROR', reasonEn: String(err?.message || err).slice(0, 200), reasonAr: 'حدث خطأ غير متوقع.' };
}

/**
 * Safe, secret-free server-side diagnostic logging for a provider health-check
 * failure - visible via `wrangler tail`. NEVER logs the API key, an
 * Authorization header, or a Firebase token; ProviderError's own message/
 * kind/httpStatus/googleStatus fields are built exclusively from the
 * provider's OWN error response, which never echoes request credentials back.
 */
function logHealthCheckFailure(provider, err) {
  if (err instanceof ProviderError) {
    console.error('ASFOUR AI Gateway health-check failure', {
      provider,
      kind: err.kind,
      httpStatus: err.httpStatus,
      googleStatus: err.googleStatus,
      message: err.message,
    });
  } else {
    console.error('ASFOUR AI Gateway health-check failure (unclassified)', {
      provider,
      message: String(err?.message || err).slice(0, 300),
    });
  }
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin, env.ALLOWED_ORIGIN);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    const pathname = new URL(request.url).pathname;
    if (request.method !== 'POST' || (pathname !== '/chat' && pathname !== '/health')) {
      return jsonResponse({ ok: false, error: 'NOT_FOUND' }, 404, headers);
    }

    if (!env.FIREBASE_PROJECT_ID) {
      // Fails loudly rather than silently - matches every provider adapter's
      // own "never pretend to be configured" rule on the frontend side.
      return jsonResponse({ ok: false, error: 'GATEWAY_NOT_CONFIGURED' }, 500, headers);
    }

    const authHeader = request.headers.get('Authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) {
      return jsonResponse({ ok: false, error: 'MISSING_AUTH' }, 401, headers);
    }

    let user;
    try {
      user = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID);
    } catch (err) {
      return jsonResponse({ ok: false, error: 'INVALID_AUTH' }, 401, headers);
    }

    const contentLength = Number(request.headers.get('Content-Length') || '0');
    if (contentLength > MAX_BODY_BYTES) {
      return jsonResponse({ ok: false, error: 'PAYLOAD_TOO_LARGE' }, 413, headers);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: 'INVALID_JSON' }, 400, headers);
    }

    const provider = VALID_PROVIDERS.has(payload?.provider) ? payload.provider : 'claude';

    if (pathname === '/health') {
      // A deliberately minimal, cheap live call - real verification (§4:
      // "do not display READY unless an actual check succeeds"), but never
      // called automatically by the frontend, only on explicit admin action.
      try {
        const result = await callProvider(env, provider, {
          system: 'Reply with the single word: ok',
          messages: [{ role: 'user', content: 'ping' }],
          maxTokens: 8,
        });
        return jsonResponse({ ok: true, status: 'READY', model: result.model }, 200, headers);
      } catch (err) {
        logHealthCheckFailure(provider, err);
        const health = healthResultFromError(err);
        return jsonResponse({ ok: true, ...health }, 200, headers);
      }
    }

    // /chat
    const { system, messages, tools } = payload || {};
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
      return jsonResponse({ ok: false, error: 'INVALID_MESSAGES' }, 400, headers);
    }
    if (tools && (!Array.isArray(tools) || tools.length > MAX_TOOLS)) {
      return jsonResponse({ ok: false, error: 'INVALID_TOOLS' }, 400, headers);
    }

    try {
      const result = await callProvider(env, provider, { system, messages, tools });
      return jsonResponse({ ok: true, ...result }, 200, headers);
    } catch (err) {
      // Never leak the raw upstream error body (could echo request internals) to the client.
      console.error('ASFOUR AI Gateway error for user', user.uid, provider, err);
      const errorCode = err instanceof ProviderError && err.kind === 'NOT_CONFIGURED'
        ? `${provider.toUpperCase()}_NOT_CONFIGURED`
        // Consolidated UX pass Item 5 - a quota exhaustion mid-chat (not just
        // a Test Connection health check) must be distinguishable from a
        // generic upstream failure too, so the live chat path can show the
        // "quota ran out, the app still works" message instead of a scary
        // generic error.
        : err instanceof ProviderError && err.kind === 'QUOTA_EXHAUSTED'
        ? 'QUOTA_EXHAUSTED'
        : err instanceof ProviderError && err.kind === 'RATE_LIMIT'
        ? 'RATE_LIMIT'
        : 'UPSTREAM_ERROR';
      return jsonResponse({ ok: false, error: errorCode }, 502, headers);
    }
  },
};
