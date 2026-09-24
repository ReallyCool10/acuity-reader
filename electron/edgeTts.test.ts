import { describe, it, expect } from 'vitest';
import { generateSecMsGec, DEFAULT_EDGE_VOICES, TRUSTED_CLIENT_TOKEN, escapeXml } from './edgeTts';

describe('electron/edgeTts', () => {
  describe('generateSecMsGec', () => {
    it('produces a 64-character uppercase hex hash', async () => {
      const token = await generateSecMsGec(TRUSTED_CLIENT_TOKEN, 1726950000000);
      expect(token).toMatch(/^[0-9A-F]{64}$/);
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
