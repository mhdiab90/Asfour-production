/**
 * ASFOUR AI Assistant - Tool-Call Normalizer.
 *
 * ONE authoritative place, at the shared gateway boundary, that decides
 * what a provider's raw text actually IS: genuine natural-language prose, a
 * RECOVERABLE textual tool-call attempt (a weak/free model tried to request
 * a real, registered tool but never used the provider's native structured
 * tool_calls mechanism), or unrecoverable leaked internal protocol that
 * must never reach the user.
 *
 * Every textual tool-call leak observed in production so far shares exactly
 * ONE invariant regardless of its wrapper syntax - it names a REAL,
 * REGISTERED tool. A bracket-pipe format ("tool_call_start]>[X(k=v)]>|"), an
 * XML pseudo-format ("<invoke name=\"X\">...</invoke>"), and a "tool_code"
 * JSON envelope ("<tool_code>{\"tool_name\":\"X\",...}</tool_code>") have
 * all been observed from OpenRouter Free alone. This module exploits that
 * shared invariant instead of chasing each new delimiter spelling - the
 * next unknown format from some other free model is expected to still be
 * caught by the SAME check, because it too will name a real tool.
 *
 * SAFETY CONTRACT (never relaxed):
 *  - A textual tool call is only ever ACCEPTED when its extracted name is
 *    an EXACT match against the caller-supplied set of currently
 *    registered/permitted tool names - never a fuzzy or partial match,
 *    never an invented name.
 *  - This module NEVER executes anything itself. It only ever returns a
 *    plain {toolName, arguments} candidate; the caller (gateway.ts) is
 *    solely responsible for running it through the SAME Permission Guard /
 *    validation / Tool Registry pipeline as a real structured tool call -
 *    there is no shortcut around that pipeline here.
 */

export interface NormalizedToolCall {
  toolName: string;
  arguments: Record<string, any>;
}

function coerceArgValue(raw: string): any {
  const trimmed = raw.trim().replace(/^['"]|['"]$/g, '');
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed !== '' && !Number.isNaN(Number(trimmed))) return Number(trimmed);
  return trimmed;
}

/** Strategy A - a JSON-object-shaped envelope anywhere in the text, with a name-like key and an args-like key. Covers "<tool_code>{...}</tool_code>", a bare "{\"name\":...,\"arguments\":{...}}", OpenAI-style function-call echoes, etc. */
function tryParseJsonEnvelope(text: string): NormalizedToolCall | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const name = parsed.tool_name ?? parsed.toolName ?? parsed.name ?? parsed.tool;
  const args = parsed.tool_input ?? parsed.toolInput ?? parsed.arguments ?? parsed.input ?? parsed.parameters;
  if (typeof name !== 'string' || !name) return null;
  return { toolName: name, arguments: args && typeof args === 'object' ? args : {} };
}

/** Strategy B - Claude-style pseudo-XML: <invoke name="X"><parameter name="k">v</parameter>...</invoke>. */
function tryParseXmlInvoke(text: string): NormalizedToolCall | null {
  const invokeMatch = text.match(/<invoke\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/invoke>/i);
  if (!invokeMatch) return null;
  const toolName = invokeMatch[1];
  const body = invokeMatch[2];
  const args: Record<string, any> = {};
  const paramPattern = /<parameter\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/parameter>/gi;
  let m: RegExpExecArray | null;
  while ((m = paramPattern.exec(body)) !== null) {
    args[m[1]] = coerceArgValue(m[2]);
  }
  return { toolName, arguments: args };
}

/** Strategy C - bracket/pipe/plain call-syntax: "[X(k=v, k2=v2)]", "X(k=v)", "tool_call_start]>[X(k=v)]>|", etc. */
function tryParseCallSyntax(text: string): NormalizedToolCall | null {
  const callMatch = text.match(/\b([A-Za-z][A-Za-z0-9_]{2,})\s*\(\s*([^()]*)\)/);
  if (!callMatch) return null;
  const toolName = callMatch[1];
  const rawArgs = callMatch[2].trim();
  const args: Record<string, any> = {};
  if (rawArgs) {
    for (const part of rawArgs.split(',')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const key = part.slice(0, eq).trim().replace(/^["']|["']$/g, '');
      const value = part.slice(eq + 1).trim();
      if (key) args[key] = coerceArgValue(value);
    }
  }
  return { toolName, arguments: args };
}

/**
 * Attempts every extraction strategy in order and accepts the FIRST result
 * whose toolName is an EXACT match in `registeredToolNames` - the one
 * non-negotiable gate. Returns null when nothing safely parses to a real,
 * registered tool (the caller must then treat the text as either genuine
 * prose or unrecoverable leaked protocol - never execute anything).
 */
export function parseTextualToolCall(text: string | undefined, registeredToolNames: ReadonlySet<string>): NormalizedToolCall | null {
  if (!text) return null;
  for (const strategy of [tryParseJsonEnvelope, tryParseXmlInvoke, tryParseCallSyntax]) {
    const candidate = strategy(text);
    if (candidate && registeredToolNames.has(candidate.toolName)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Is this text INTERNAL PROTOCOL that must never reach visible assistant
 * text, regardless of whether parseTextualToolCall() above could safely
 * recover a real tool call from it? Two independent signals:
 *  1. Structural leak markers seen in the wild (tag-based pseudo-XML,
 *     specific bare protocol tokens).
 *  2. The SEMANTIC, format-agnostic signal: the text literally names one of
 *     our OWN registered tools - genuine Arabic/English business prose
 *     never contains a raw camelCase internal identifier like
 *     "getTopEmployees" as a substring, so its presence is a reliable tell
 *     regardless of whatever wrapper syntax surrounds it, known or not.
 */
const STRUCTURAL_LEAK_PATTERN = /<\s*\/?\s*(function_calls|invoke|parameter|tool_call|tool_use|tool_code)\b|\b(tool_call_start|tool_call_end|dots_function_call|arg_key|arg_value|tool_name|tool_input)\b/i;

export function containsToolProtocolLeak(text: string | undefined, registeredToolNames: ReadonlySet<string>): boolean {
  if (!text) return false;
  if (STRUCTURAL_LEAK_PATTERN.test(text)) return true;
  for (const name of registeredToolNames) {
    if (text.includes(name)) return true;
  }
  return false;
}
