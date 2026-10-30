/**
 * Deepgram text-to-speech (Speak API).
 *
 * The key is read from the server environment only, so it never reaches the
 * browser and is never written into a lesson record. `DEEPGRAM_BASE_URL` and
 * `DEEPGRAM_TTS_MODEL` let the deployment point at a different region or voice
 * without a code change; the defaults are the ones used to validate the pilot.
 *
 * The endpoint answers with the encoded audio stream itself, so a failure is a
 * non-2xx response rather than a JSON error inside a 200.
 */

const DEFAULT_BASE_URL = 'https://api.deepgram.com';
export const DEFAULT_MODEL = 'flux-naveen-en';

export type SpeechRequest = {
  text: string;
  model?: string;
  speed?: number;
  expressivity?: number;
};

export type SpeechResult = { audio?: Buffer; contentType?: string; error?: string };

export function deepgramConfigured(): boolean {
  return Boolean(String(process.env.DEEPGRAM_API_KEY || '').trim());
}

export function deepgramModel(): string {
  return String(process.env.DEEPGRAM_TTS_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

/**
 * Speaks the text. `speed` and `expressivity` are only sent when they are given,
 * so the provider's own defaults apply when the Studio leaves them alone.
 */
export async function synthesizeSpeech(input: SpeechRequest): Promise<SpeechResult> {
  const key = String(process.env.DEEPGRAM_API_KEY || '').trim();
  if (!key) {
    return { error: 'Deepgram is not configured yet — add DEEPGRAM_API_KEY to the app secrets.' };
  }
  const text = String(input.text || '').trim();
  if (!text) return { error: 'There is no narration text to speak.' };

  const base = String(process.env.DEEPGRAM_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const params = new URLSearchParams({ model: String(input.model || '').trim() || deepgramModel() });
  if (Number.isFinite(input.speed)) params.set('speed', String(input.speed));
  if (Number.isFinite(input.expressivity)) params.set('expressivity', String(input.expressivity));

  let response: Response;
  try {
    response = await fetch(`${base}/v2/speak?${params.toString()}`, {
      method: 'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(120_000)
    });
  } catch (cause) {
    return { error: `Could not reach Deepgram: ${(cause as Error).message}` };
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300).trim();
    return { error: `Deepgram returned ${response.status}${detail ? `: ${detail}` : ` ${response.statusText}`}` };
  }

  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length === 0) return { error: 'Deepgram returned an empty audio file.' };
  return { audio, contentType: response.headers.get('content-type') || 'audio/mpeg' };
}
