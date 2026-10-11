/*
 * Makes shelf thumbnails off the UI thread: decodes a full-size cover with the
 * browser's own decoders (JPEG, PNG, WebP), shrinks it, and encodes a JPEG.
 * Driven by src/lib/thumbnails.ts.
 */
import { COVER_BACKGROUND, THUMB_JPEG_QUALITY, thumbnailSize } from '../lib/coverArt';
import type { ThumbnailRequest, ThumbnailResponse } from '../lib/thumbnails';

async function makeThumbnail(bytes: Uint8Array): Promise<Uint8Array> {
  // Bytes that arrive by postMessage are always backed by a plain ArrayBuffer.
  const source = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>]));
  const { width, height } = thumbnailSize(source.width, source.height);
  const scaled = await createImageBitmap(source, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
  source.close();
  try {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No 2D context');
    context.fillStyle = COVER_BACKGROUND;
    context.fillRect(0, 0, width, height);
    context.drawImage(scaled, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: THUMB_JPEG_QUALITY });
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    scaled.close();
  }
}

self.onmessage = async (event: MessageEvent<ThumbnailRequest>) => {
  const { id, bytes } = event.data;
  let response: ThumbnailResponse;
  try {
    const jpeg = await makeThumbnail(bytes);
    response = { id, jpeg };
    self.postMessage(response, { transfer: [jpeg.buffer] });
  } catch (err) {
    response = { id, error: String(err) };
    self.postMessage(response);
  }
};
