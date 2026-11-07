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
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split('.')[0];
const SEC_MS_GEC_VERSION = `2-${CHROMIUM_FULL_VERSION}`;
const USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`;
/** Per-attempt limit; a healthy request for an 800-character chunk takes 1-3 s. */
const ATTEMPT_TIMEOUT_MS = 15000;

/*
 * The protocol below mirrors the reference client (github.com/rany2/edge-tts)
 * field for field. The endpoint is undocumented and strict: it closes the
 * socket without audio when the SSML strays from the shape Edge itself sends
 * (extra namespaces, <break> elements), and answers 403 when the
 * Sec-MS-GEC token is built from a clock more than a few minutes out. Every
 * such failure used to drop narration to the Windows voice without a word.
 */

/**
 * Difference between Microsoft's clock and this machine's, learned from the
 * Date header of a rejected handshake. The token is valid only for the
 * five-minute window the server is in, so a PC whose clock is a few minutes out
 * is refused every time until this is corrected.
 */
let clockSkewMs = 0;

export function getClockSkewMs(): number {
  return clockSkewMs;
}

/** Test hook. */
export function setClockSkewMs(value: number): void {
  clockSkewMs = value;
}

/**
 * Learn the clock skew from a server Date header. Returns true when the
 * correction changed by more than a second, i.e. a retry is worth making.
 */
export function adjustClockSkew(serverDate: string | undefined, now: number = Date.now()): boolean {
  if (!serverDate) return false;
  const server = Date.parse(serverDate);
  if (Number.isNaN(server)) return false;
  const next = server - now;
  const changed = Math.abs(next - clockSkewMs) > 1000;
  clockSkewMs = next;
  return changed;
}

/** Why online synthesis failed, so the reader can say so instead of switching voice silently. */
export type EdgeTtsFailure = 'offline' | 'rejected' | 'timeout' | 'no-audio';

export class EdgeTtsError extends Error {
  readonly kind: EdgeTtsFailure;
  readonly status?: number;
  constructor(kind: EdgeTtsFailure, message: string, status?: number) {
    super(message);
    this.name = 'EdgeTtsError';
    this.kind = kind;
    this.status = status;
  }
}

/** The v1 token input: Windows file-time ticks, rounded down to five minutes, then the client token. */
export function secMsGecInput(trustedClientToken: string, timestampMs: number): string {
  const seconds = Math.floor(timestampMs / 1000) + 11644473600;
  const rounded = seconds - (seconds % 300);
  return `${BigInt(rounded) * 10000000n}${trustedClientToken}`;
}

/*
 * Sec-MS-GEC v2, required since late 2026 (v1 tokens are refused with 403):
 * "<CS64 checksum>-<SHA-256>" of Edge's copyright line followed by the v1 input.
 * Adapted from msedge-tts (MIT licence, github.com/Migushthe2nd/MsEdgeTTS),
 * which worked it out from the analysis in github.com/rany2/edge-tts/pull/492.
 */
const EDGE_COPYRIGHT = 'Copyright (C) Microsoft Corporation. All rights reserved.';
const SWAP_FIRST = [0xef0569fb, 0x76f50f34, 0xc3efea97] as const;
const SWAP_SECOND = [0xc31713db, 0x1881ce3c, 0x35bd1ec9] as const;
const MIX_FIRST = [0xcf98b111, 0x87085b9f, 0x12ceb96d, 0x257e1d83] as const;
const MIX_SECOND = [0xa27416f5, 0xd38396ff, 0x7c932b89, 0xbfa49f69] as const;

const swapHalves = (value: number) => ((value << 16) | (value >>> 16)) >>> 0;

function swapTerm(word: number, key: number, [swappedWord, swappedSum, swappedProduct]: readonly number[]): number {
  const sum = Math.imul(word, key) + Math.imul(swapHalves(word), swappedWord);
  const product = Math.imul(swapHalves(sum), swappedSum) >>> 0;
  return (Math.imul(swapHalves(product), swappedProduct) + product) >>> 0;
}

function swapAndMultiply(value: number, multipliers: readonly number[]): number {
  for (const multiplier of multipliers) value = Math.imul(swapHalves(value), multiplier) >>> 0;
  return value;
}

/** The 64-bit checksum keyed by the first eight bytes of the SHA-256 digest. */
function cs64(message: Uint8Array, digest: Uint8Array): Buffer {
  const digestView = new DataView(digest.buffer, digest.byteOffset, digest.byteLength);
  const firstKey = (digestView.getUint32(0, true) | 1) >>> 0;
  const secondKey = (digestView.getUint32(4, true) | 1) >>> 0;
  // Read as little-endian 32-bit word pairs, zero-padded to a whole pair.
  const padded = new Uint8Array(Math.ceil(message.length / 8) * 8);
  padded.set(message);
  const words = new DataView(padded.buffer);
  let swapSum = 0;
  let lastSwap = 0;
  let mix = 0;
  let mixSum = 0;
  for (let offset = 0; offset < padded.length; offset += 8) {
    const first = words.getUint32(offset, true);
    const second = words.getUint32(offset + 4, true);
    const firstSwap = swapTerm(first, firstKey, SWAP_FIRST);
    lastSwap = swapTerm(second, secondKey, SWAP_SECOND);
    swapSum = (swapSum + firstSwap + lastSwap) >>> 0;
    mix = swapAndMultiply(Math.imul(mix + first, firstKey), MIX_FIRST);
    mixSum = (mixSum + mix) >>> 0;
    mix = swapAndMultiply(Math.imul(mix + second, secondKey), MIX_SECOND);
    mixSum = (mixSum + mix) >>> 0;
  }
  const checksum = Buffer.alloc(8);
  checksum.writeUInt32LE((lastSwap ^ mix) >>> 0, 0);
  checksum.writeUInt32LE((swapSum ^ mixSum) >>> 0, 4);
  return checksum;
}

/** The Sec-MS-GEC (v2) token for the five-minute window containing `timestampMs`. */
export function generateSecMsGec(
  trustedClientToken: string = TRUSTED_CLIENT_TOKEN,
  timestampMs: number = Date.now() + clockSkewMs
): string {
  const message = Buffer.from(EDGE_COPYRIGHT + secMsGecInput(trustedClientToken, timestampMs), 'ascii');
  const digest = crypto.createHash('sha256').update(message).digest();
  return `${cs64(message, digest).toString('hex')}-${digest.toString('hex')}`.toUpperCase();
}

export function generateMuid(): string {
  return crypto.randomBytes(16).toString('hex').toUpperCase();
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
    const fetchVoices = async () =>
      fetch(`${VOICES_URL}&Sec-MS-GEC=${generateSecMsGec()}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Pragma': 'no-cache',
          'Cache-Control': 'no-cache',
        },
        signal: AbortSignal.timeout(6000),
      });

    let res = await fetchVoices();
    if (res.status === 403 && adjustClockSkew(res.headers.get('date') ?? undefined)) {
      res = await fetchVoices();
    }
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

/**
 * Replace the C0 control characters XML 1.0 forbids outright - everything below
 * 0x20 except tab, newline and carriage return - with spaces.
 *
 * Book text does contain them (stray form feeds and NULs from PDF extraction),
 * and a single one makes the SSML document malformed, so synthesis fails.
 * Done by character code rather than a regex: a character-class regex over
 * control characters trips ESLint's no-control-regex, whose job is catching
 * accidental ones, and this is deliberate.
 */
function replaceXmlIllegalControlChars(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    const forbidden = code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d;
    out += forbidden ? ' ' : ch;
  }
  return out;
}

export function escapeXml(text: string): string {
  return replaceXmlIllegalControlChars(text)
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

export const DEFAULT_VOICE = 'en-US-JennyNeural';

/**
 * Expand a short voice name ("en-US-JennyNeural") to the long form the service
 * expects in SSML ("Microsoft Server Speech Text to Speech Voice (en-US, JennyNeural)").
 * Region-qualified names keep the region with the locale:
 * "zh-CN-liaoning-XiaobeiNeural" becomes "(zh-CN-liaoning, XiaobeiNeural)".
 */
export function toLongVoiceName(voice: string): string {
  const match = /^([a-z]{2,})-([A-Z]{2,})-(.+Neural)$/.exec(voice.trim());
  if (!match) return voice.trim();
  let locale = `${match[1]}-${match[2]}`;
  let name = match[3];
  const dash = name.indexOf('-');
  if (dash !== -1) {
    locale += `-${name.slice(0, dash)}`;
    name = name.slice(dash + 1);
  }
  return `Microsoft Server Speech Text to Speech Voice (${locale}, ${name})`;
}

/** "+25%" / "-20%" from a speed multiplier. */
export function rateToProsody(rate: number = 1): string {
  const pct = Math.round((rate - 1) * 100);
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

/**
 * The SSML document, in exactly the shape Edge sends: one voice, one prosody
 * element, plain escaped text. The service refuses anything richer from this
 * endpoint (it once received `<break>` pauses and an mstts namespace here, and
 * answered by closing the socket without audio).
 */
export function buildSsml(text: string, voice: string = DEFAULT_VOICE, rate: number = 1): string {
  return (
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
    `<voice name='${escapeXml(toLongVoiceName(voice))}'>` +
    `<prosody pitch='+0Hz' rate='${rateToProsody(rate)}' volume='+0%'>` +
    escapeXml(text) +
    '</prosody></voice></speak>'
  );
}

/** The JavaScript Date.toString() form the service expects, always in UTC. */
export function edgeTimestamp(date: Date = new Date()): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${days[date.getUTCDay()]} ${months[date.getUTCMonth()]} ${pad(date.getUTCDate())} ${date.getUTCFullYear()} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} ` +
    'GMT+0000 (Coordinated Universal Time)'
  );
}

export function speechConfigMessage(timestamp: string = edgeTimestamp()): string {
  return (
    `X-Timestamp:${timestamp}\r\n` +
    'Content-Type:application/json; charset=utf-8\r\n' +
    'Path:speech.config\r\n\r\n' +
    '{"context":{"synthesis":{"audio":{"metadataoptions":{' +
    '"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},' +
    '"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n'
  );
}

export function ssmlMessage(requestId: string, ssml: string, timestamp: string = edgeTimestamp()): string {
  // The trailing "Z" after a non-ISO timestamp is what Edge sends; kept as-is.
  return (
    `X-RequestId:${requestId}\r\n` +
    'Content-Type:application/ssml+xml\r\n' +
    `X-Timestamp:${timestamp}Z\r\n` +
    'Path:ssml\r\n\r\n' +
    ssml
  );
}

function parseHeaders(block: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of block.split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return headers;
}

/**
 * A binary frame is a big-endian 16-bit header length, the headers, then the
 * audio. Reading the length (rather than searching for "Path:audio") does not
 * depend on the order the service lists its headers in.
 */
export function parseBinaryFrame(frame: Buffer): { path?: string; body: Buffer } | null {
  if (frame.length < 2) return null;
  const headerLength = frame.readUInt16BE(0);
  if (2 + headerLength > frame.length) return null;
  const headers = parseHeaders(frame.subarray(2, 2 + headerLength).toString('utf8'));
  return { path: headers.path, body: frame.subarray(2 + headerLength) };
}

export function parseTextFrame(message: string): { path?: string; body: string } {
  const split = message.indexOf('\r\n\r\n');
  const head = split === -1 ? message : message.slice(0, split);
  const body = split === -1 ? '' : message.slice(split + 4);
  return { path: parseHeaders(head).path, body };
}

/** Word boundaries from an audio.metadata frame. Offsets are in 100 ns ticks. */
export function parseMetadata(body: string): EdgeBoundary[] {
  const boundaries: EdgeBoundary[] = [];
  let json: { Metadata?: Array<{ Type?: string; Data?: { Offset?: number; Duration?: number; text?: { Text?: string; Length?: number } } }> };
  try {
    json = JSON.parse(body);
  } catch {
    return boundaries;
  }
  for (const item of json.Metadata ?? []) {
    const type = item.Type === 'WordBoundary' ? 'word' : item.Type === 'SentenceBoundary' ? 'sentence' : null;
    const text = item.Data?.text?.Text;
    if (!type || !text) continue;
    boundaries.push({
      type,
      offsetMs: Math.round((item.Data?.Offset ?? 0) / 10000),
      durationMs: Math.round((item.Data?.Duration ?? 0) / 10000),
      text,
      length: item.Data?.text?.Length ?? text.length,
    });
  }
  return boundaries;
}

const NETWORK_ERROR_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'ETIMEDOUT', 'EHOSTUNREACH']);

function toEdgeError(err: unknown): EdgeTtsError {
  if (err instanceof EdgeTtsError) return err;
  const code = (err as { code?: string } | null)?.code;
  if (code && NETWORK_ERROR_CODES.has(code)) {
    return new EdgeTtsError('offline', "Can't reach Microsoft's speech service. Check the internet connection.");
  }
  const message = err instanceof Error ? err.message : String(err);
  return new EdgeTtsError('offline', `Microsoft's speech service could not be reached (${message}).`);
}

interface SocketLike {
  on(event: 'open', listener: () => void): unknown;
  on(event: 'message', listener: (data: WebSocket.RawData, isBinary: boolean) => void): unknown;
  on(event: 'unexpected-response', listener: (req: unknown, res: { statusCode?: number; statusMessage?: string; headers: Record<string, string | string[] | undefined> }) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  on(event: 'close', listener: (code: number, reason: Buffer) => void): unknown;
  send(data: string): void;
  close(): void;
  terminate?(): void;
}

export type SocketFactory = (url: string, headers: Record<string, string>) => SocketLike;

const defaultSocketFactory: SocketFactory = (url, headers) => new WebSocket(url, { headers });

/** One request on one socket. Retrying is the caller's business. */
async function attemptSynthesis(
  text: string,
  voice: string,
  rate: number,
  createSocket: SocketFactory
): Promise<EdgeSynthesisResult> {
  const connectionId = crypto.randomUUID().replace(/-/g, '');
  const secMsGec = generateSecMsGec();
  const url =
    `${WSS_URL}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
    `&ConnectionId=${connectionId}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;

  return new Promise<EdgeSynthesisResult>((resolve, reject) => {
    const audioChunks: Buffer[] = [];
    const boundaries: EdgeBoundary[] = [];
    let settled = false;
    let socket: SocketLike | null = null;

    const finish = (outcome: { result?: EdgeSynthesisResult; error?: EdgeTtsError }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // already closing
      }
      if (outcome.result) resolve(outcome.result);
      else reject(outcome.error);
    };

    const result = (): EdgeSynthesisResult => ({
      audioBase64: Buffer.concat(audioChunks).toString('base64'),
      mimeType: 'audio/mpeg',
      boundaries: [...boundaries].sort((a, b) => a.offsetMs - b.offsetMs),
    });

    const timer = setTimeout(() => {
      finish({ error: new EdgeTtsError('timeout', "Microsoft's speech service took too long to answer.") });
    }, ATTEMPT_TIMEOUT_MS);

    try {
      socket = createSocket(url, {
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
        'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'User-Agent': USER_AGENT,
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': `muid=${generateMuid()};`,
      });
    } catch (err) {
      finish({ error: toEdgeError(err) });
      return;
    }

    socket.on('open', () => {
      socket?.send(speechConfigMessage());
      socket?.send(ssmlMessage(crypto.randomUUID().replace(/-/g, ''), buildSsml(text, voice, rate)));
    });

    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        const buf = Buffer.isBuffer(data)
          ? data
          : Array.isArray(data)
            ? Buffer.concat(data)
            : Buffer.from(data as ArrayBuffer);
        const frame = parseBinaryFrame(buf);
        if (frame?.path === 'audio' && frame.body.length > 0) audioChunks.push(frame.body);
        return;
      }
      const { path: framePath, body } = parseTextFrame(data.toString());
      if (framePath === 'audio.metadata') {
        boundaries.push(...parseMetadata(body));
      } else if (framePath === 'turn.end') {
        if (audioChunks.length > 0) finish({ result: result() });
        else finish({ error: new EdgeTtsError('no-audio', 'Microsoft returned no audio for this passage.') });
      }
    });

    socket.on('unexpected-response', (_req, res) => {
      const status = res.statusCode ?? 0;
      const date = res.headers?.date;
      const error = new EdgeTtsError(
        'rejected',
        status === 403
          ? "Microsoft's speech service refused the request (HTTP 403). If this persists, the app may need an update."
          : `Microsoft's speech service refused the request (HTTP ${status}).`,
        status
      );
      // Surface the server's clock so the caller can correct the token.
      (error as EdgeTtsError & { serverDate?: string }).serverDate = Array.isArray(date) ? date[0] : date;
      finish({ error });
      // The 'unexpected-response' handler owns the request; end it.
      socket?.terminate?.();
    });

    socket.on('error', (err) => finish({ error: toEdgeError(err) }));

    socket.on('close', (code, reason) => {
      if (audioChunks.length > 0) {
        finish({ result: result() });
      } else {
        finish({
          error: new EdgeTtsError(
            'no-audio',
            `Microsoft closed the connection without audio (code ${code}${reason?.length ? `: ${reason.toString()}` : ''}).`
          ),
        });
      }
    });
  });
}

/**
 * Synthesize text with Microsoft Edge's online neural voices. Resolves with MP3
 * audio (base64) and word boundary timings.
 *
 * Tries twice. A 403 carrying the server's Date header corrects the clock skew
 * first; any other failure is retried once after a short pause, because a
 * single dropped socket should not cost the user their chosen voice.
 */
export async function synthesizeEdgeSpeech(
  options: SynthesisOptions,
  createSocket: SocketFactory = defaultSocketFactory
): Promise<EdgeSynthesisResult> {
  const text = options.text.trim();
  if (!text) return { audioBase64: '', mimeType: 'audio/mpeg', boundaries: [] };

  const voice = options.voice || DEFAULT_VOICE;
  const rate = options.rate ?? 1;

  try {
    return await attemptSynthesis(text, voice, rate, createSocket);
  } catch (err) {
    const error = toEdgeError(err);
    const serverDate = (error as EdgeTtsError & { serverDate?: string }).serverDate;
    if (error.status === 403) {
      // Only a clock correction can change the outcome of a 403.
      if (!adjustClockSkew(serverDate)) throw error;
    } else {
      await new Promise((r) => setTimeout(r, 400));
    }
    return attemptSynthesis(text, voice, rate, createSocket).catch((retryErr) => {
      throw toEdgeError(retryErr);
    });
  }
}
