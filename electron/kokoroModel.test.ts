import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  downloadModel,
  getModelStatus,
  KOKORO_DOWNLOAD_BYTES,
  KOKORO_MODEL,
  ModelDownloadError,
  removeModel,
  type FetchLike,
  type ModelManifest,
} from './kokoroModel';

const contents: Record<string, Buffer> = {
  'config.json': Buffer.from('{"model":"kokoro"}'),
  'onnx/model.onnx': crypto.randomBytes(50_000),
};
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const manifest: ModelManifest = {
  repository: 'test/repo',
  revision: 'abc123',
  folder: 'kokoro',
  files: Object.entries(contents).map(([p, b]) => ({ path: p, size: b.length, sha256: sha(b) })),
};

/** Serves `contents` in small pieces, like a real streamed download. */
function fakeFetch(override: Partial<Record<string, Buffer>> = {}): FetchLike & { urls: string[] } {
  const urls: string[] = [];
  const fn = (async (url: string) => {
    urls.push(url);
    const name = url.split('/resolve/abc123/')[1];
    const body = override[name] ?? contents[name];
    if (!body) return { ok: false, status: 404, body: null };
    return {
      ok: true,
      status: 200,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          for (let i = 0; i < body.length; i += 4096) controller.enqueue(new Uint8Array(body.subarray(i, i + 4096)));
          controller.close();
        },
      }),
    };
  }) as FetchLike & { urls: string[] };
  fn.urls = urls;
  return fn;
}

describe('kokoroModel', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'acuity-voices-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('pins a revision and verifies every file; the download is about 92 MB', () => {
    expect(KOKORO_MODEL.revision).toMatch(/^[0-9a-f]{40}$/);
    for (const file of KOKORO_MODEL.files) expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Math.round(KOKORO_DOWNLOAD_BYTES / 1e6)).toBe(92);
  });

  it('is not installed until downloaded, then is, from the pinned revision', async () => {
    expect((await getModelStatus(root, manifest)).installed).toBe(false);
    const fetch = fakeFetch();
    const progress = vi.fn();

    await downloadModel(root, { fetch, onProgress: progress }, manifest);

    expect((await getModelStatus(root, manifest)).installed).toBe(true);
    expect(fetch.urls[0]).toBe('https://huggingface.co/test/repo/resolve/abc123/config.json');
    expect(fs.readFileSync(path.join(root, 'kokoro/onnx/model.onnx'))).toEqual(contents['onnx/model.onnx']);
    const last = progress.mock.calls.at(-1)?.[0];
    expect(last.receivedBytes).toBe(last.totalBytes);
  });

  it('discards a file whose hash does not match, and is not installed', async () => {
    const tampered = Buffer.from(contents['onnx/model.onnx']);
    tampered[100] ^= 0xff;
    await expect(downloadModel(root, { fetch: fakeFetch({ 'onnx/model.onnx': tampered }) }, manifest)).rejects.toBeInstanceOf(
      ModelDownloadError
    );
    expect((await getModelStatus(root, manifest)).installed).toBe(false);
    expect(fs.existsSync(path.join(root, 'kokoro/onnx/model.onnx'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'kokoro/onnx/model.onnx.part'))).toBe(false);
  });

  it('reports a server error in plain words', async () => {
    const fetch: FetchLike = async () => ({ ok: false, status: 503, body: null });
    await expect(downloadModel(root, { fetch }, manifest)).rejects.toThrow('HTTP 503');
  });

  it('is no longer installed when a file is damaged or the revision changes', async () => {
    await downloadModel(root, { fetch: fakeFetch() }, manifest);
    expect((await getModelStatus(root, { ...manifest, revision: 'newer' })).installed).toBe(false);
    fs.writeFileSync(path.join(root, 'kokoro/onnx/model.onnx'), 'short');
    expect((await getModelStatus(root, manifest)).installed).toBe(false);
  });

  it('removes the model', async () => {
    await downloadModel(root, { fetch: fakeFetch() }, manifest);
    await removeModel(root, manifest);
    expect(fs.existsSync(path.join(root, 'kokoro'))).toBe(false);
  });
});
