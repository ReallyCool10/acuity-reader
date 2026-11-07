import { describe, it, expect } from 'vitest';
import {
  adjustClockSkew,
  buildSsml,
  DEFAULT_EDGE_VOICES,
  EdgeTtsError,
  edgeTimestamp,
  escapeXml,
  generateMuid,
  generateSecMsGec,
  getClockSkewMs,
  parseBinaryFrame,
  parseMetadata,
  rateToProsody,
  setClockSkewMs,
  synthesizeEdgeSpeech,
  toLongVoiceName,
  TRUSTED_CLIENT_TOKEN,
  type SocketFactory,
} from './edgeTts';

describe('electron/edgeTts', () => {
  describe('generateMuid', () => {
    it('produces a 32-character uppercase hex string', () => {
      const muid = generateMuid();
      expect(muid).toMatch(/^[0-9A-F]{32}$/);
    });

    it('generates unique values on subsequent calls', () => {
      const muid1 = generateMuid();
      const muid2 = generateMuid();
      expect(muid1).not.toBe(muid2);
    });
  });

  describe('generateSecMsGec', () => {
    it('produces a v2 token: a 16-hex checksum, then the 64-hex SHA-256', () => {
      const token = generateSecMsGec(TRUSTED_CLIENT_TOKEN, 1726950000000);
      expect(token).toMatch(/^[0-9A-F]{16}-[0-9A-F]{64}$/);
    });

    it('matches a token the live service accepted', () => {
      // Pinned output of the algorithm Microsoft's endpoint accepted in a live test in November
      // 2026 (v1 tokens were refused with 403), so a refactor cannot change it unnoticed.
      expect(generateSecMsGec(TRUSTED_CLIENT_TOKEN, 1726950000000)).toBe(
        '1BEC8F1F02C80625-FD9316C72E60BB73FBB4D1C66D27A0AFDF6D9684D1F982C5DCD8ADA76C501F8C'
      );
    });

    it('is deterministic for the same timestamp and token', async () => {
      const token1 = await generateSecMsGec(TRUSTED_CLIENT_TOKEN, 1726950000000);
      const token2 = await generateSecMsGec(TRUSTED_CLIENT_TOKEN, 1726950000000);
      expect(token1).toBe(token2);
    });

    it('aligns to 5-minute rolling windows', async () => {
      // 1726950000000 ms is divisible by 300,000 ms (5 minutes)
      const baseMs = 1726950000000;
      const withinWindow1 = baseMs + 50 * 1000; // +50s
      const withinWindow2 = baseMs + 250 * 1000; // +250s
      const nextWindow = baseMs + 350 * 1000; // +350s (next window)

      const t1 = await generateSecMsGec(TRUSTED_CLIENT_TOKEN, withinWindow1);
      const t2 = await generateSecMsGec(TRUSTED_CLIENT_TOKEN, withinWindow2);
      const t3 = await generateSecMsGec(TRUSTED_CLIENT_TOKEN, nextWindow);

      expect(t1).toBe(t2);
      expect(t1).not.toBe(t3);
    });
  });

  describe('DEFAULT_EDGE_VOICES', () => {
    it('includes primary natural English voices', () => {
      const names = DEFAULT_EDGE_VOICES.map((v) => v.name);
      expect(names).toContain('en-US-JennyNeural');
      expect(names).toContain('en-US-GuyNeural');
      expect(names).toContain('en-GB-SoniaNeural');
    });

    it('has valid metadata structure for all fallback voices', () => {
      for (const v of DEFAULT_EDGE_VOICES) {
        expect(v.name).toBeTruthy();
        expect(v.friendlyName).toContain('Natural');
        expect(v.locale).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
        expect(['Female', 'Male']).toContain(v.gender);
      }
    });
  });
});

describe('escapeXml', () => {
  it('replaces control characters XML 1.0 forbids, so the SSML stays well-formed', () => {
    expect(escapeXml('a\u0000b\u0008c\u000Bd\u000Ce\u001Ff')).toBe('a b c d e f');
  });

  it('keeps the whitespace controls XML allows', () => {
    expect(escapeXml('a\tb\nc\rd')).toBe('a\tb\nc\rd');
  });

  it('escapes markup characters', () => {
    expect(escapeXml(`<p a="1">Tom & Jerry's</p>`)).toBe(
      '&lt;p a=&quot;1&quot;&gt;Tom &amp; Jerry&apos;s&lt;/p&gt;'
    );
  });

  it('leaves non-ASCII text intact', () => {
    expect(escapeXml('naïve café — 日本語 😀')).toBe('naïve café — 日本語 😀');
  });
});

describe('Edge protocol', () => {
  it('expands short voice names to the long form the service expects', () => {
    expect(toLongVoiceName('en-US-JennyNeural')).toBe('Microsoft Server Speech Text to Speech Voice (en-US, JennyNeural)');
    expect(toLongVoiceName('en-AU-WilliamMultilingualNeural')).toBe(
      'Microsoft Server Speech Text to Speech Voice (en-AU, WilliamMultilingualNeural)'
    );
    expect(toLongVoiceName('zh-CN-liaoning-XiaobeiNeural')).toBe(
      'Microsoft Server Speech Text to Speech Voice (zh-CN-liaoning, XiaobeiNeural)'
    );
  });

  it('builds SSML in the plain shape Edge sends: no breaks, no extra namespaces', () => {
    const ssml = buildSsml('One.\n\nTwo & three', 'en-GB-SoniaNeural', 1.25);
    expect(ssml).toBe(
      "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
        "<voice name='Microsoft Server Speech Text to Speech Voice (en-GB, SoniaNeural)'>" +
        "<prosody pitch='+0Hz' rate='+25%' volume='+0%'>One.\n\nTwo &amp; three</prosody></voice></speak>"
    );
    expect(ssml).not.toContain('<break');
    expect(ssml).not.toContain('mstts');
  });

  it('formats rates as signed percentages', () => {
    expect(rateToProsody(1)).toBe('+0%');
    expect(rateToProsody(0.8)).toBe('-20%');
    expect(rateToProsody(2)).toBe('+100%');
  });

  it('formats timestamps the way Edge does, in UTC', () => {
    expect(edgeTimestamp(new Date(Date.UTC(2026, 10, 7, 9, 5, 3)))).toBe(
      'Sat Nov 07 2026 09:05:03 GMT+0000 (Coordinated Universal Time)'
    );
  });

  it('reads audio frames by their header length, whatever order the headers come in', () => {
    const frame = binaryFrame('Path:audio\r\nContent-Type:audio/mpeg\r\nX-RequestId:abc\r\n', Buffer.from([1, 2, 3]));
    const parsed = parseBinaryFrame(frame);
    expect(parsed?.path).toBe('audio');
    expect([...parsed!.body]).toEqual([1, 2, 3]);
  });

  it('turns word boundary metadata into millisecond timings', () => {
    expect(parseMetadata(metadataBody([[10_000_000, 3_000_000, 'Hello']]))).toEqual([
      { type: 'word', offsetMs: 1000, durationMs: 300, text: 'Hello', length: 5 },
    ]);
  });

  it('learns clock skew from a server Date header', () => {
    setClockSkewMs(0);
    const now = Date.UTC(2026, 10, 7, 12, 0, 0);
    expect(adjustClockSkew(new Date(now + 7 * 60_000).toUTCString(), now)).toBe(true);
    expect(getClockSkewMs()).toBe(7 * 60_000);
    // A second, identical correction is not worth a retry.
    expect(adjustClockSkew(new Date(now + 7 * 60_000).toUTCString(), now)).toBe(false);
    expect(adjustClockSkew(undefined, now)).toBe(false);
    setClockSkewMs(0);
  });
});

describe('synthesizeEdgeSpeech', () => {
  type Handler = (...args: never[]) => void;

  /** A scripted stand-in for the service: `script` runs once the socket opens. */
  function fakeService(attempts: Array<(socket: FakeSocket) => void>) {
    const sent: string[][] = [];
    const urls: string[] = [];
    let attempt = 0;
    const factory: SocketFactory = (url) => {
      const script = attempts[Math.min(attempt, attempts.length - 1)];
      attempt += 1;
      urls.push(url);
      const socket = new FakeSocket();
      sent.push(socket.sent);
      queueMicrotask(() => script(socket));
      return socket;
    };
    return { factory, sent, urls, attempts: () => attempt };
  }

  class FakeSocket {
    sent: string[] = [];
    handlers: Record<string, Handler[]> = {};
    on(event: string, handler: Handler) {
      (this.handlers[event] ??= []).push(handler);
      return this;
    }
    emit(event: string, ...args: unknown[]) {
      for (const handler of this.handlers[event] ?? []) (handler as (...a: unknown[]) => void)(...args);
    }
    send(data: string) {
      this.sent.push(data);
    }
    close() {}
    terminate() {}
  }

  const speak = (socket: FakeSocket) => {
    socket.emit('open');
    socket.emit('message', Buffer.from(`Path:audio.metadata\r\n\r\n${metadataBody([[0, 2_000_000, 'Hi']])}`), false);
    socket.emit('message', binaryFrame('Path:audio\r\n', Buffer.from([9, 9])), true);
    socket.emit('message', Buffer.from('Path:turn.end\r\n\r\n{}'), false);
  };

  it('sends the speech config and SSML, and returns the audio and word timings', async () => {
    const service = fakeService([speak]);
    const result = await synthesizeEdgeSpeech({ text: 'Hi', voice: 'en-US-GuyNeural' }, service.factory);

    expect(Buffer.from(result.audioBase64, 'base64')).toEqual(Buffer.from([9, 9]));
    expect(result.mimeType).toBe('audio/mpeg');
    expect(result.boundaries).toEqual([{ type: 'word', offsetMs: 0, durationMs: 200, text: 'Hi', length: 2 }]);
    expect(service.sent[0][0]).toContain('Path:speech.config');
    expect(service.sent[0][1]).toContain("Microsoft Server Speech Text to Speech Voice (en-US, GuyNeural)");
    expect(service.urls[0]).toMatch(/Sec-MS-GEC=[0-9A-F]{16}-[0-9A-F]{64}&Sec-MS-GEC-Version=2-/);
  });

  it('corrects for a wrong PC clock when the service answers 403, and retries', async () => {
    setClockSkewMs(0);
    const serverDate = new Date(Date.now() + 10 * 60_000).toUTCString();
    const service = fakeService([
      (socket) => socket.emit('unexpected-response', {}, { statusCode: 403, headers: { date: serverDate } }),
      speak,
    ]);

    const result = await synthesizeEdgeSpeech({ text: 'Hi' }, service.factory);

    expect(result.audioBase64).not.toBe('');
    expect(service.attempts()).toBe(2);
    expect(Math.abs(getClockSkewMs() - 10 * 60_000)).toBeLessThan(5000);
    // The retry carried a different token, built from the corrected clock.
    expect(service.urls[1].match(/Sec-MS-GEC=([\w-]+)/)?.[1]).not.toBe(service.urls[0].match(/Sec-MS-GEC=([\w-]+)/)?.[1]);
    setClockSkewMs(0);
  });

  it('does not retry a 403 when the clock was already right', async () => {
    setClockSkewMs(0);
    const service = fakeService([
      (socket) => socket.emit('unexpected-response', {}, { statusCode: 403, headers: { date: new Date().toUTCString() } }),
    ]);

    await expect(synthesizeEdgeSpeech({ text: 'Hi' }, service.factory)).rejects.toMatchObject({ kind: 'rejected', status: 403 });
    expect(service.attempts()).toBe(1);
  });

  it('retries once when the connection drops, then reports that no audio came back', async () => {
    const service = fakeService([(socket) => socket.emit('close', 1006, Buffer.alloc(0))]);

    await expect(synthesizeEdgeSpeech({ text: 'Hi' }, service.factory)).rejects.toBeInstanceOf(EdgeTtsError);
    expect(service.attempts()).toBe(2);
  });

  it('describes an unreachable service as a connection problem', async () => {
    const offline = Object.assign(new Error('getaddrinfo ENOTFOUND speech.platform.bing.com'), { code: 'ENOTFOUND' });
    const service = fakeService([(socket) => socket.emit('error', offline)]);

    await expect(synthesizeEdgeSpeech({ text: 'Hi' }, service.factory)).rejects.toMatchObject({
      kind: 'offline',
      message: expect.stringContaining('internet connection'),
    });
  });
});

function binaryFrame(headers: string, body: Buffer): Buffer {
  const head = Buffer.from(headers, 'utf8');
  const length = Buffer.alloc(2);
  length.writeUInt16BE(head.length);
  return Buffer.concat([length, head, body]);
}

function metadataBody(words: Array<[number, number, string]>): string {
  return JSON.stringify({
    Metadata: words.map(([offset, duration, text]) => ({
      Type: 'WordBoundary',
      Data: { Offset: offset, Duration: duration, text: { Text: text, Length: text.length } },
    })),
  });
}
