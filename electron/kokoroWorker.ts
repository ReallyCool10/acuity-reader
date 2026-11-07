/*
 * The offline voice, in its own process.
 *
 * Started by kokoroService.ts as an Electron utility process. Kokoro's model
 * takes about 700 MB of memory and keeps every CPU core busy while it speaks;
 * in a separate process that work cannot slow the window, a crash in the
 * native ONNX runtime cannot take the app down with it, and the memory is
 * returned when the service stops the process after a few idle minutes.
 *
 * Nothing here touches the network: remote models are disabled and the model
 * is loaded from the folder given as the first argument.
 */
import { env } from '@huggingface/transformers';
import { KokoroTTS } from 'kokoro-js';
import type { EdgeBoundary } from './edgeTts';
import { KOKORO_MODEL } from './kokoroModel';
import { encodeWav, estimateWordBoundaries, KOKORO_SAMPLE_RATE, splitForSynthesis } from './kokoroTiming';

export interface KokoroRequest {
  id: number;
  text: string;
  /** Kokoro voice name, e.g. "af_heart". */
  voice: string;
  speed: number;
}

export type KokoroResponse =
  | { id: number; ok: true; audioBase64: string; mimeType: string; boundaries: EdgeBoundary[] }
  | { id: number; ok: false; error: string };

type KokoroVoice = Parameters<KokoroTTS['generate']>[1] extends infer O ? (O extends { voice?: infer V } ? V : never) : never;

const voicesRoot = process.argv[2];
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = voicesRoot;

let model: Promise<KokoroTTS> | null = null;
const load = () =>
  (model ??= KokoroTTS.from_pretrained(KOKORO_MODEL.folder, { dtype: KOKORO_MODEL.dtype, device: 'cpu' }).catch(
    (err) => {
      model = null;
      throw err;
    }
  ));

async function synthesize({ text, voice, speed }: KokoroRequest) {
  const tts = await load();
  if (!(voice in tts.voices)) throw new Error(`Unknown offline voice "${voice}".`);
  const audio: Float32Array[] = [];
  const boundaries: EdgeBoundary[] = [];
  let elapsedMs = 0;
  for (const piece of splitForSynthesis(text)) {
    const { audio: samples } = await tts.generate(piece, { voice: voice as KokoroVoice, speed });
    const durationMs = (samples.length / KOKORO_SAMPLE_RATE) * 1000;
    boundaries.push(...estimateWordBoundaries(piece, elapsedMs, durationMs));
    audio.push(samples);
    elapsedMs += durationMs;
  }
  return { audioBase64: encodeWav(audio).toString('base64'), mimeType: 'audio/wav', boundaries };
}

// One request at a time: each already uses every core.
let queue: Promise<void> = Promise.resolve();

process.parentPort.on('message', (event: { data: KokoroRequest }) => {
  const request = event.data;
  queue = queue.then(async () => {
    let response: KokoroResponse;
    try {
      response = { id: request.id, ok: true, ...(await synthesize(request)) };
    } catch (err) {
      response = { id: request.id, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    process.parentPort.postMessage(response);
  });
});
