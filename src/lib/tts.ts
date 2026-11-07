/**
 * Shared labelling for the read-aloud engines.
 *
 * Acuity offers two: Microsoft's online neural voices, and whatever voices the
 * operating system provides locally. The distinction matters beyond audio
 * quality — the online engine transmits the text being read to a Microsoft
 * endpoint, so the wording here has to make that legible at the point of choice
 * rather than burying it in documentation.
 */

/** Sentinel voice id selecting the offline, OS-provided engine. */
export const LOCAL_VOICE_ID = 'system-local';

export const VOICE_GROUP_ONLINE = 'Online — Microsoft (sends text)';
export const VOICE_GROUP_LOCAL = 'On this device';
export const LOCAL_VOICE_LABEL = 'System voice (offline)';

export const TTS_PRIVACY_NOTICE =
  'Online voices send the text being read aloud to Microsoft to synthesise audio, and need an internet connection. The system voice runs entirely on this device.';

export function isOnlineVoice(voiceId: string): boolean {
  return voiceId !== LOCAL_VOICE_ID;
}

/**
 * A reader-facing sentence for a failed online synthesis.
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
  return message || "Microsoft's online voice is unavailable right now.";
}

export const FALLBACK_NOTICE_SUFFIX = 'Reading with the system voice for now.';
