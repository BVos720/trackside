/**
 * Local model client — spec §5.3.
 *
 * Talks to an Ollama server over HTTP. Deliberately thin: the prompt and all
 * validation live in `core/logic/timetable.ts`, which is pure and tested, and
 * this file only moves bytes. That split is what lets the parsing rules be
 * verified without a model running.
 *
 * ── Model choice and licensing, spec §8 ────────────────────────────────────
 * The default is Gemma 3 4B, which is small enough to run comfortably on a
 * laptop and more than capable of the narrow job in §5.3 — pulling start and
 * finish times out of a schedule.
 *
 * Gemma is NOT Apache 2.0. It ships under Google's Gemma Terms of Use, which
 * carry a prohibited-use policy and require passing those terms to anyone you
 * distribute the weights to. §8 flags exactly this class of licence and says to
 * prefer Qwen or Mistral if the app is ever distributed. Personal use is fine;
 * shipping is where it bites. `OLLAMA_MODEL` is configuration so the swap is a
 * one-line change — `qwen2.5:3b` is the obvious Apache-2.0 alternative at a
 * similar size.
 *
 * ── Local, not hosted ──────────────────────────────────────────────────────
 * Running locally is also what keeps §5.3 honest about privacy: a timetable is
 * harmless, but the same pipeline eventually sees entry lists and personal
 * notes, and none of that should leave the machine.
 */
import { buildPrompt, parseSessions, type ParseResult } from '../core/logic/timetable';

export const OLLAMA_URL = 'http://localhost:11434';

/**
 * Default model.
 *
 * 4B rather than 12B: this task is extraction against a short document with a
 * tightly constrained output shape, not reasoning. The larger model is slower
 * and does not do it better.
 */
export const OLLAMA_MODEL = 'gemma3:4b';

export class OllamaUnavailableError extends Error {
  constructor(cause: string) {
    super(
      `Could not reach Ollama at ${OLLAMA_URL} (${cause}). ` +
        `Start it with "ollama serve" and pull the model with "ollama pull ${OLLAMA_MODEL}".`,
    );
    this.name = 'OllamaUnavailableError';
  }
}

/** True when a server is reachable and the model is present. */
export async function checkOllama(
  model: string = OLLAMA_MODEL,
): Promise<{ reachable: boolean; hasModel: boolean; models: string[] }> {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { method: 'GET' });
    if (!r.ok) return { reachable: false, hasModel: false, models: [] };
    const body = (await r.json()) as { models?: { name?: string }[] };
    const models = (body.models ?? [])
      .map((m) => m.name)
      .filter((n): n is string => typeof n === 'string');
    // Ollama reports tags as "gemma3:4b"; a bare "gemma3" should still match.
    const hasModel = models.some((n) => n === model || n.startsWith(`${model}:`));
    return { reachable: true, hasModel, models };
  } catch {
    return { reachable: false, hasModel: false, models: [] };
  }
}

/**
 * Extract sessions from a pasted timetable.
 *
 * Returns the same `ParseResult` shape whatever happens, including rejections,
 * so the caller always has something to show. §5.3 requires the output be
 * confirmed by the user before anything is committed — this function
 * deliberately returns candidates and never writes.
 */
export async function extractTimetable(
  scheduleText: string,
  model: string = OLLAMA_MODEL,
): Promise<ParseResult> {
  let response: Response;
  try {
    response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: buildPrompt(scheduleText),
        stream: false,
        // Ollama's JSON mode constrains decoding to valid JSON. It does not
        // guarantee the right *shape*, which is why parseSessions still
        // validates every field.
        format: 'json',
        options: {
          // Extraction, not writing. Near-zero temperature keeps the model from
          // paraphrasing session names or inventing plausible times.
          temperature: 0,
        },
      }),
    });
  } catch (e) {
    throw new OllamaUnavailableError(e instanceof Error ? e.message : String(e));
  }

  if (!response.ok) {
    throw new OllamaUnavailableError(`HTTP ${response.status}`);
  }

  const body = (await response.json()) as { response?: unknown };
  const text = typeof body.response === 'string' ? body.response : '';
  if (text.trim() === '') {
    return {
      sessions: [],
      rejected: [{ raw: {}, reason: 'Model returned an empty response.' }],
    };
  }

  return parseSessions(text);
}
