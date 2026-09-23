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
