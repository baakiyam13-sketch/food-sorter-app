import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Gemini reply is mocked: these tests never make real API calls.
let mockReplyText = '{"isFood":true,"item":"Apple","score":9,"reason":"Apples are yummy and good for you."}';

vi.mock('@google/genai', () => {
  class MockGoogleGenAI {
    models = {
      generateContent: async () => ({ text: mockReplyText }),
    };
  }
  return {
    GoogleGenAI: MockGoogleGenAI,
    Type: { OBJECT: 'OBJECT', BOOLEAN: 'BOOLEAN', STRING: 'STRING', INTEGER: 'INTEGER' },
  };
});

import handler, { validateScoreReply } from '../netlify/functions/score';

// A few JPEG bytes (every JPEG starts with FF D8), base64 encoded.
const TINY_JPEG_BASE64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString('base64');

function post(body: unknown): Request {
  return new Request('http://localhost/.netlify/functions/score', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-key';
  mockReplyText =
    '{"isFood":true,"item":"Apple","score":9,"reason":"Apples are yummy and good for you."}';
});

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
});

describe('validateScoreReply', () => {
  it('accepts a valid reply', () => {
    const result = validateScoreReply(
      '{"isFood":true,"item":"Apple","score":9,"reason":"Good for you."}',
    );
    expect(result).toEqual({ isFood: true, item: 'Apple', score: 9, reason: 'Good for you.' });
  });

  it('accepts a not-food reply', () => {
    const result = validateScoreReply(
      '{"isFood":false,"item":"","score":0,"reason":"I can only see a table."}',
    );
    expect(result.isFood).toBe(false);
    expect(result.score).toBe(0);
  });

  it('rejects a reply that is not valid JSON', () => {
    expect(() => validateScoreReply('not json at all')).toThrow('not valid JSON');
  });

  it('rejects a score outside 0 to 10 and never guesses one', () => {
    expect(() =>
      validateScoreReply('{"isFood":true,"item":"Cake","score":11,"reason":"Yum."}'),
    ).toThrow('whole number from 0 to 10');
    expect(() =>
      validateScoreReply('{"isFood":true,"item":"Cake","score":-1,"reason":"Yum."}'),
    ).toThrow('whole number from 0 to 10');
    expect(() =>
      validateScoreReply('{"isFood":true,"item":"Cake","score":7.5,"reason":"Yum."}'),
    ).toThrow('whole number from 0 to 10');
  });

  it('rejects missing fields', () => {
    expect(() => validateScoreReply('{"item":"Apple","score":9,"reason":"Good."}')).toThrow();
    expect(() =>
      validateScoreReply('{"isFood":true,"item":"Apple","score":9}'),
    ).toThrow('missing a reason');
  });
});

describe('score function handler', () => {
  it('rejects anything that is not a POST', async () => {
    const res = await handler(new Request('http://localhost/.netlify/functions/score'));
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: 'POST only' });
  });

  it('rejects when the API key is missing', async () => {
    delete process.env.GEMINI_API_KEY;
    const res = await handler(post({ image: TINY_JPEG_BASE64 }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('key');
  });

  it('rejects a body over about 1.5 MB', async () => {
    const res = await handler(
      new Request('http://localhost/.netlify/functions/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: 'A'.repeat(1_600_000) }),
      }),
    );
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toContain('too big');
  });

  it('rejects a body that is not JSON', async () => {
    const res = await handler(
      new Request('http://localhost/.netlify/functions/score', {
        method: 'POST',
        body: 'hello',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects an image that is not valid base64 with a 400, never a 500', async () => {
    const res = await handler(post({ image: '!!!this is not base64!!!' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'That does not look like a JPEG image' });
  });

  it('rejects non-JPEG bytes with a 400, never a 500', async () => {
    const notJpeg = Buffer.from('this is plain text, not a photo').toString('base64');
    const res = await handler(post({ image: notJpeg }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'That does not look like a JPEG image' });
  });

  it('rejects a request with no image', async () => {
    const res = await handler(post({}));
    expect(res.status).toBe(400);
  });

  it('returns the validated score from the (mocked) AI', async () => {
    const res = await handler(post({ image: TINY_JPEG_BASE64 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      isFood: true,
      item: 'Apple',
      score: 9,
      reason: 'Apples are yummy and good for you.',
    });
  });

  it('returns an error, never a guessed score, when the AI reply is bad', async () => {
    mockReplyText = 'sorry, I cannot help with that';
    const res = await handler(post({ image: TINY_JPEG_BASE64 }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain('not valid JSON');
    expect(body.score).toBeUndefined();
  });

  it('returns an error when the AI score is out of range', async () => {
    mockReplyText = '{"isFood":true,"item":"Cake","score":42,"reason":"So yummy."}';
    const res = await handler(post({ image: TINY_JPEG_BASE64 }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.score).toBeUndefined();
  });
});
