import WebSocket from 'ws';
import * as crypto from 'node:crypto';

export interface EdgeVoice {
  name: string;
  friendlyName: string;
  locale: string;
  gender: 'Female' | 'Male';
  suggested?: boolean;
}

export interface EdgeBoundary {
  offsetMs: number;
  durationMs: number;
  text: string;
  length: number;
  type: 'word' | 'sentence';
}

export interface EdgeSynthesisResult {
  audioBase64: string;
  mimeType: string;
  boundaries: EdgeBoundary[];
}

export const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const VOICES_URL = `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}`;
const WSS_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const CHROMIUM_VERSION = '1-143.0.3650.96';
const AUDIO_DELIM = 'Path:audio\r\n';
const JSON_XML_DELIM = '\r\n\r\n';

/**
 * Generates the Sec-MS-GEC authorization token using Windows NT epoch ticks
 * aligned to 5-minute rolling windows.
 */
export async function generateSecMsGec(trustedClientToken: string = TRUSTED_CLIENT_TOKEN, timestampMs: number = Date.now()): Promise<string> {
  const ticks = Math.floor(timestampMs / 1000) + 11644473600;
  const rounded = ticks - (ticks % 300);
  const windowsTicks = rounded * 10000000;
  const data = new TextEncoder().encode(`${windowsTicks}${trustedClientToken}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/** Fallback voices available even if network voice catalog discovery fails. */
export const DEFAULT_EDGE_VOICES: EdgeVoice[] = [
  { name: 'en-US-JennyNeural', friendlyName: 'Microsoft Jenny Online (Natural) - English (United States)', locale: 'en-US', gender: 'Female', suggested: true },
  { name: 'en-US-GuyNeural', friendlyName: 'Microsoft Guy Online (Natural) - English (United States)', locale: 'en-US', gender: 'Male', suggested: true },
  { name: 'en-US-AriaNeural', friendlyName: 'Microsoft Aria Online (Natural) - English (United States)', locale: 'en-US', gender: 'Female', suggested: true },
  { name: 'en-GB-SoniaNeural', friendlyName: 'Microsoft Sonia Online (Natural) - English (United Kingdom)', locale: 'en-GB', gender: 'Female', suggested: true },
  { name: 'en-GB-RyanNeural', friendlyName: 'Microsoft Ryan Online (Natural) - English (United Kingdom)', locale: 'en-GB', gender: 'Male', suggested: true },
  { name: 'en-AU-WilliamMultilingualNeural', friendlyName: 'Microsoft WilliamMultilingual Online (Natural) - English (Australia)', locale: 'en-AU', gender: 'Male' },
  { name: 'en-CA-ClaraNeural', friendlyName: 'Microsoft Clara Online (Natural) - English (Canada)', locale: 'en-CA', gender: 'Female' },
  { name: 'en-IE-EmilyNeural', friendlyName: 'Microsoft Emily Online (Natural) - English (Ireland)', locale: 'en-IE', gender: 'Female' },
];

let cachedVoices: EdgeVoice[] | null = null;

/**
 * Fetches the list of all Microsoft Edge online neural voices.
 */
export async function getEdgeVoices(): Promise<EdgeVoice[]> {
  if (cachedVoices) return cachedVoices;

  try {
    const res = await fetch(VOICES_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
      },
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const raw = (await res.json()) as Array<{
      ShortName: string;
      FriendlyName: string;
      Locale: string;
      Gender: string;
    }>;

    const voices: EdgeVoice[] = raw.map((v) => ({
      name: v.ShortName,
      friendlyName: v.FriendlyName,
      locale: v.Locale,
      gender: v.Gender === 'Male' ? 'Male' : 'Female',
      suggested:
        v.ShortName === 'en-US-JennyNeural' ||
        v.ShortName === 'en-US-GuyNeural' ||
        v.ShortName === 'en-US-AriaNeural' ||
        v.ShortName === 'en-GB-SoniaNeural' ||
        v.ShortName === 'en-GB-RyanNeural',
    }));

    // Prioritize English and suggested voices at the top
    voices.sort((a, b) => {
      if (a.suggested && !b.suggested) return -1;
      if (!a.suggested && b.suggested) return 1;
      const aIsEn = a.locale.startsWith('en-');
      const bIsEn = b.locale.startsWith('en-');
      if (aIsEn && !bIsEn) return -1;
      if (!aIsEn && bIsEn) return 1;
      return a.locale.localeCompare(b.locale);
    });

    cachedVoices = voices;
    return voices;
  } catch (err) {
    console.warn('Edge TTS voice discovery failed, using bundled defaults:', err);
    return DEFAULT_EDGE_VOICES;
  }
}

function escapeXml(text: string): string {
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface SynthesisOptions {
  text: string;
  voice?: string;
  rate?: number; // 1.0 is default, 1.25 is +25%, 0.8 is -20%
  pitch?: number; // 0 is default
}

/**
 * Synthesizes text using Microsoft Edge's Neural Text-To-Speech engine.
 * Streams word boundaries and audio chunks over a WebSocket and resolves
 * with MP3 audio (base64) and precise boundary timing markers.
 */
export async function synthesizeEdgeSpeech(options: SynthesisOptions): Promise<EdgeSynthesisResult> {
  const text = options.text.trim();
  if (!text) {
    return { audioBase64: '', mimeType: 'audio/mp3', boundaries: [] };
  }

  const voiceName = options.voice || 'en-US-JennyNeural';
  const rate = options.rate ?? 1.0;
  const pctRate = Math.round((rate - 1.0) * 100);
  const rateStr = pctRate >= 0 ? `+${pctRate}%` : `${pctRate}%`;
  const pitchStr = '+0Hz';

  const connectionId = crypto.randomUUID().replace(/-/g, '');
  const secMsGec = await generateSecMsGec(TRUSTED_CLIENT_TOKEN);
  const synthUrl = `${WSS_URL}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${CHROMIUM_VERSION}&ConnectionId=${connectionId}`;

  return new Promise<EdgeSynthesisResult>((resolve, reject) => {
    let ws: WebSocket | null = null;
    let timeoutId: NodeJS.Timeout | null = null;
    const audioChunks: Buffer[] = [];
    const boundaries: EdgeBoundary[] = [];

    let isSettled = false;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (ws) {
        try {
          ws.close();
        } catch {
          // ignore
        }
        ws = null;
      }
    };

    const doResolve = (result: EdgeSynthesisResult) => {
      if (isSettled) return;
      isSettled = true;
      cleanup();
      resolve(result);
    };

    const doReject = (err: Error) => {
      if (isSettled) return;
      isSettled = true;
      cleanup();
      reject(err);
    };

    timeoutId = setTimeout(() => {
      doReject(new Error('Edge TTS synthesis timed out after 20 seconds.'));
    }, 20000);

    try {
      ws = new WebSocket(synthUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
          'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
          'Pragma': 'no-cache',
          'Cache-Control': 'no-cache',
        },
      });

      ws.binaryType = 'arraybuffer';

      ws.on('open', () => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        // 1. Send speech.config
        const configMsg =
          `Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
          JSON.stringify({
            context: {
              synthesis: {
                audio: {
                  metadataoptions: {
                    sentenceBoundaryEnabled: 'true',
                    wordBoundaryEnabled: 'true',
                  },
                  outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
                },
              },
            },
          });
        ws.send(configMsg);

        // 2. Send SSML
        const reqId = crypto.randomUUID().replace(/-/g, '');
        const escaped = escapeXml(text);
        const locale = voiceName.split('-').slice(0, 2).join('-');
        // Convert paragraph and heading structural breaks into natural speech pauses
        const ssmlBody = escaped.replace(/\n\n+/g, '<break time="550ms" />\n');
        const ssml =
          `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${locale}">` +
          `<voice name="${voiceName}">` +
          `<prosody pitch="${pitchStr}" rate="${rateStr}">` +
          `${ssmlBody}` +
          `</prosody></voice></speak>`;

        const ssmlMsg = `X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${new Date().toUTCString()}Z\r\nPath:ssml\r\n\r\n${ssml}`;
        ws.send(ssmlMsg);
      });

      ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
        if (isBinary) {
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
          const delimIdx = buf.indexOf(AUDIO_DELIM);
          if (delimIdx !== -1) {
            const audioData = buf.subarray(delimIdx + AUDIO_DELIM.length);
            if (audioData.length > 0) {
              audioChunks.push(audioData);
            }
          }
        } else {
          const msg = data.toString('utf-8');
          if (msg.includes('Path:audio.metadata')) {
            const idx = msg.indexOf(JSON_XML_DELIM);
            if (idx !== -1) {
              try {
                const json = JSON.parse(msg.slice(idx + JSON_XML_DELIM.length));
                for (const item of json.Metadata ?? []) {
                  const type = item.Type === 'WordBoundary' ? 'word' : item.Type === 'SentenceBoundary' ? 'sentence' : null;
                  if (type && item.Data?.text) {
                    boundaries.push({
                      type,
                      offsetMs: Math.round(item.Data.Offset / 10000), // 100ns to ms
                      durationMs: Math.round(item.Data.Duration / 10000),
                      text: item.Data.text.Text,
                      length: item.Data.text.Length ?? item.Data.text.Text.length,
                    });
                  }
                }
              } catch {
                // skip malformed metadata frame
              }
            }
          } else if (msg.includes('Path:turn.end')) {
            const totalAudio = Buffer.concat(audioChunks);
            boundaries.sort((a, b) => a.offsetMs - b.offsetMs);
            doResolve({
              audioBase64: totalAudio.toString('base64'),
              mimeType: 'audio/mp3',
              boundaries,
            });
          }
        }
      });

      ws.on('error', (err) => {
        doReject(err instanceof Error ? err : new Error(String(err)));
      });

      ws.on('close', (code, reason) => {
        if (audioChunks.length > 0) {
          const totalAudio = Buffer.concat(audioChunks);
          boundaries.sort((a, b) => a.offsetMs - b.offsetMs);
          doResolve({
            audioBase64: totalAudio.toString('base64'),
            mimeType: 'audio/mp3',
            boundaries,
          });
        } else {
          doReject(new Error(`WebSocket closed before audio received: code=${code} ${reason.toString()}`));
        }
      });
    } catch (err) {
      doReject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
