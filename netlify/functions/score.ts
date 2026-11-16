// Netlify Function: scores a photo of food with Google Gemini.
// The GEMINI_API_KEY env var is read here, on the server. The browser
// never sees the key. The image is not stored or logged anywhere.

import { GoogleGenAI, Type } from '@google/genai';

const MAX_BODY_BYTES = 1_500_000; // reject bodies over about 1.5 MB

export interface ScoreResult {
  isFood: boolean;
  item: string;
  score: number;
  reason: string;
}

const PROMPT = [
  'Look at this photo for a child\'s school project.',
  'If it shows a food or drink item, say what it is and rate how healthy it',
  'is for a child: 10 is very healthy (like fruit or vegetables), 0 is very',
  'junk (like sweets or fizzy drinks).',
  'If there is no food or drink in the photo, set isFood to false, item to',
  'an empty string and score to 0.',
  'reason must be one short sentence an 8-year-old can read.',
].join(' ');

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    isFood: { type: Type.BOOLEAN },
    item: { type: Type.STRING },
    score: { type: Type.INTEGER },
    reason: { type: Type.STRING },
  },
  required: ['isFood', 'item', 'score', 'reason'],
};

// Check the AI reply before trusting it. Never return a guessed score:
// anything that is not valid JSON with a whole-number score from 0 to 10
// is an error instead.
export function validateScoreReply(text: string): ScoreResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('The AI reply was not valid JSON');
  }
  const r = data as Record<string, unknown>;
  if (typeof r !== 'object' || r === null) {
    throw new Error('The AI reply was not a JSON object');
  }
  if (typeof r.isFood !== 'boolean') {
    throw new Error('The AI reply is missing isFood');
  }
  if (typeof r.item !== 'string') {
    throw new Error('The AI reply is missing an item name');
  }
  if (typeof r.score !== 'number' || !Number.isInteger(r.score) || r.score < 0 || r.score > 10) {
    throw new Error('The AI score was not a whole number from 0 to 10');
  }
  if (typeof r.reason !== 'string' || r.reason.trim() === '') {
    throw new Error('The AI reply is missing a reason');
  }
  return { isFood: r.isFood, item: r.item, score: r.score, reason: r.reason };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return json({ error: 'POST only' }, 405);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return json({ error: 'The AI key is not set up yet. Ask a grown-up.' }, 500);
  }

  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return json({ error: 'That photo is too big (over 1.5 MB)' }, 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'The request body must be JSON' }, 400);
  }
  const image = (body as Record<string, unknown>)?.image;
  if (typeof image !== 'string' || image.length === 0) {
    return json({ error: 'The request must carry a base64 JPEG image' }, 400);
  }
  // A JPEG always starts with the bytes FF D8. Invalid base64 throws, so
  // catch it and answer 400 — bad input is never a 500.
  let head: string;
  try {
    head = atob(image.slice(0, 8));
  } catch {
    return json({ error: 'That does not look like a JPEG image' }, 400);
  }
  if (head.length < 2 || head.charCodeAt(0) !== 0xff || head.charCodeAt(1) !== 0xd8) {
    return json({ error: 'That does not look like a JPEG image' }, 400);
  }

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const ai = new GoogleGenAI({ apiKey });
  let text: string;
  try {
    const reply = await ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [{ inlineData: { mimeType: 'image/jpeg', data: image } }, { text: PROMPT }],
        },
      ],
      config: { responseMimeType: 'application/json', responseSchema },
    });
    text = reply.text ?? '';
  } catch {
    return json({ error: 'The AI could not score that photo. Try again.' }, 502);
  }

  try {
    return json(validateScoreReply(text), 200);
  } catch (err) {
    return json({ error: (err as Error).message }, 502);
  }
};
