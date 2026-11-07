import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/*
 * The offline voice's model files: what they are, whether they are present,
 * and fetching them when - and only when - the user asks.
 *
 * The app loads nothing from the web on its own, so the model is not bundled
 * or fetched in the background: the user chooses "Download" in the voice
 * picker or Settings. Files come from a pinned revision of the model
 * repository and are checked against their SHA-256 before use, so a changed or
 * truncated file is never loaded. The voices themselves (style vectors) ship
 * inside the kokoro-js package and need no download.
 */

export interface ModelFile {
  /** Path inside the model folder and the repository. */
  path: string;
  size: number;
  sha256: string;
}

export interface ModelManifest {
  repository: string;
  revision: string;
  folder: string;
  files: ModelFile[];
}

/** Kokoro-82M v1.0, 8-bit quantised ONNX export (Apache-2.0). */
export const KOKORO_MODEL = {
  repository: 'onnx-community/Kokoro-82M-v1.0-ONNX',
  revision: '1939ad2a8e416c0acfeecc08a694d14ef25f2231',
  /** Folder name under the voices directory; also the model ID given to transformers.js. */
  folder: 'kokoro',
  dtype: 'q8' as const,
  files: [
    { path: 'config.json', size: 44, sha256: 'df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f' },
    { path: 'tokenizer.json', size: 3497, sha256: '77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34' },
    { path: 'tokenizer_config.json', size: 113, sha256: 'be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20' },
    {
      path: 'onnx/model_quantized.onnx',
      size: 92361116,
      sha256: 'fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478',
    },
  ] satisfies ModelFile[],
} satisfies ModelManifest & { dtype: 'q8' };

const totalBytes = (manifest: ModelManifest) => manifest.files.reduce((sum, file) => sum + file.size, 0);

export const KOKORO_DOWNLOAD_BYTES = totalBytes(KOKORO_MODEL);

/** Written last, once every file has been verified; its presence means "installed". */
const MARKER = 'installed.json';

export function modelDir(voicesRoot: string, manifest: ModelManifest = KOKORO_MODEL): string {
  return path.join(voicesRoot, manifest.folder);
}

export function fileUrl(file: ModelFile, manifest: ModelManifest = KOKORO_MODEL): string {
  return `https://huggingface.co/${manifest.repository}/resolve/${manifest.revision}/${file.path}`;
}

export interface ModelStatus {
  installed: boolean;
  /** Bytes the download takes. */
  downloadBytes: number;
}

/**
 * Installed when the marker for this revision is present and every file has the
 * expected size. Sizes are checked on each call (cheap); hashes were checked
 * when the files were downloaded.
 */
export async function getModelStatus(
  voicesRoot: string,
  manifest: ModelManifest = KOKORO_MODEL
): Promise<ModelStatus> {
  const dir = modelDir(voicesRoot, manifest);
  const status = { installed: false, downloadBytes: totalBytes(manifest) };
  try {
    const marker = JSON.parse(await fs.promises.readFile(path.join(dir, MARKER), 'utf8')) as { revision?: string };
    if (marker.revision !== manifest.revision) return status;
    for (const file of manifest.files) {
      const { size } = await fs.promises.stat(path.join(dir, file.path));
      if (size !== file.size) return status;
    }
    return { ...status, installed: true };
  } catch {
    return status;
  }
}

export interface DownloadProgress {
  receivedBytes: number;
  totalBytes: number;
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  body: ReadableStream<Uint8Array> | null;
}>;

export class ModelDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelDownloadError';
  }
}

/**
 * Download and verify every model file, then write the marker. Each file is
 * written to a `.part` file and renamed only once its hash matches, so an
 * interrupted or cancelled download leaves nothing that looks installed.
 */
export async function downloadModel(
  voicesRoot: string,
  options: { fetch: FetchLike; onProgress?: (progress: DownloadProgress) => void; signal?: AbortSignal },
  manifest: ModelManifest = KOKORO_MODEL
): Promise<void> {
  const dir = modelDir(voicesRoot, manifest);
  await fs.promises.rm(path.join(dir, MARKER), { force: true });
  let receivedBytes = 0;
  const report = () => options.onProgress?.({ receivedBytes, totalBytes: totalBytes(manifest) });

  for (const file of manifest.files) {
    const target = path.join(dir, file.path);
    const part = `${target}.part`;
    await fs.promises.mkdir(path.dirname(target), { recursive: true });

    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await options.fetch(fileUrl(file, manifest), { signal: options.signal });
    } catch (err) {
      if (options.signal?.aborted) throw err;
      throw new ModelDownloadError("Couldn't reach Hugging Face to download the voice. Check the internet connection.");
    }
    if (!response.ok || !response.body) {
      throw new ModelDownloadError(`The voice download failed (HTTP ${response.status}).`);
    }

    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(part);
    let written = 0;
    try {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        written += value.length;
        receivedBytes += value.length;
        if (!out.write(value)) await new Promise<void>((resolve) => out.once('drain', () => resolve()));
        report();
      }
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    } catch (err) {
      out.destroy();
      await fs.promises.rm(part, { force: true });
      if (options.signal?.aborted) throw err;
      throw new ModelDownloadError('The voice download was interrupted. Try again.');
    }

    if (written !== file.size || hash.digest('hex') !== file.sha256) {
      await fs.promises.rm(part, { force: true });
      throw new ModelDownloadError('The downloaded voice did not match what was expected, so it was discarded.');
    }
    await fs.promises.rename(part, target);
  }

  await fs.promises.writeFile(
    path.join(dir, MARKER),
    JSON.stringify({ revision: manifest.revision, installedAt: new Date().toISOString() })
  );
}

export async function removeModel(voicesRoot: string, manifest: ModelManifest = KOKORO_MODEL): Promise<void> {
  await fs.promises.rm(modelDir(voicesRoot, manifest), { recursive: true, force: true });
}
