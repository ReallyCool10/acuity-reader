/**
 * Shared labelling for the read-aloud engines.
 *
 * Acuity offers Microsoft's online neural voices, Kokoro's offline neural
 * voices, and the basic voice Windows provides. The distinction matters beyond
 * audio quality — the online engine transmits the text being read to a
 * Microsoft endpoint, so the wording here has to make that legible at the point
 * of choice rather than burying it in documentation.
 */

/*
 * Three engines, told apart by the voice ID:
 *   online  - a Microsoft voice name, e.g. "en-GB-SoniaNeural" (sends text to Microsoft)
 *   offline - "kokoro:" plus a Kokoro voice, e.g. "kokoro:bf_emma" (runs on this PC)
 *   system  - LOCAL_VOICE_ID, the basic Windows voice (runs on this PC)
 * Only an online ID may ever cause text to leave the machine; engineOf decides.
 */
export type VoiceEngine = 'online' | 'offline' | 'system';

/** Sentinel voice id selecting the basic, OS-provided engine. */
export const LOCAL_VOICE_ID = 'system-local';
export const OFFLINE_VOICE_PREFIX = 'kokoro:';
export const DEFAULT_ONLINE_VOICE = 'en-US-JennyNeural';
export const DEFAULT_OFFLINE_VOICE = 'kokoro:af_heart';

export function engineOf(voiceId: string): VoiceEngine {
  if (voiceId === LOCAL_VOICE_ID) return 'system';
  if (voiceId.startsWith(OFFLINE_VOICE_PREFIX)) return 'offline';
  return 'online';
}

export function isOnlineVoice(voiceId: string): boolean {
  return engineOf(voiceId) === 'online';
}

/** "kokoro:bf_emma" -> "bf_emma". */
export function offlineVoiceName(voiceId: string): string {
  return voiceId.slice(OFFLINE_VOICE_PREFIX.length);
}

/**
 * The Kokoro voices offered, best first. Kokoro ships more, but the rest are
 * graded well below these by the model's authors; English only.
 */
export const OFFLINE_VOICES: { id: string; label: string }[] = [
  { id: 'kokoro:af_heart', label: 'Heart (US) — Warm ★' },
  { id: 'kokoro:af_bella', label: 'Bella (US) — Bright ★' },
  { id: 'kokoro:af_nicole', label: 'Nicole (US) — Soft' },
  { id: 'kokoro:am_michael', label: 'Michael (US)' },
  { id: 'kokoro:am_fenrir', label: 'Fenrir (US) — Deep' },
  { id: 'kokoro:am_puck', label: 'Puck (US) — Lively' },
  { id: 'kokoro:bf_emma', label: 'Emma (UK) ★' },
  { id: 'kokoro:bf_isabella', label: 'Isabella (UK)' },
  { id: 'kokoro:bm_george', label: 'George (UK)' },
  { id: 'kokoro:bm_fable', label: 'Fable (UK)' },
];

export const VOICE_GROUP_ONLINE = 'Online — Microsoft (sends text)';
export const VOICE_GROUP_LOCAL = 'On this device';
export const LOCAL_VOICE_LABEL = 'Basic system voice';

export const ONLINE_PRIVACY_NOTICE =
  'Online voices send the text being read aloud to Microsoft to make the audio, and need an internet connection.';
export const OFFLINE_PRIVACY_NOTICE =
  'Offline voices run entirely on this PC: nothing is sent anywhere, and they work without a connection.';
/** Kept for existing imports: both halves of the disclosure. */
export const TTS_PRIVACY_NOTICE = `${ONLINE_PRIVACY_NOTICE} ${OFFLINE_PRIVACY_NOTICE}`;

/** The second half of a fallback notice: what narration carries on with. */
export function fallbackSuffix(to: 'offline' | 'system'): string {
  return to === 'offline' ? 'Reading with the offline voice for now.' : 'Reading with the basic system voice for now.';
}

/**
 * A reader-facing sentence for a failed synthesis, online or offline.
 *
 * Errors thrown in the main process reach the renderer wrapped as
 * "Error invoking remote method 'tts:synthesizeEdge': EdgeTtsError: ...";
 * only the last part means anything to a reader.
 */
export function describeSynthesisError(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const message = raw
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^(?:EdgeTts)?Error:\s*/, '')
    .trim();
  return message || 'The chosen voice is unavailable right now.';
}
