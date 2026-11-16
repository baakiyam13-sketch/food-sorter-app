// Calls the Netlify Function that asks Gemini for the health score.
// The API key lives on the server; the browser never sees it.

export interface ScoreResult {
  isFood: boolean;
  item: string;
  score: number;
  reason: string;
}

export async function scorePhoto(base64Jpeg: string): Promise<ScoreResult> {
  const res = await fetch('/.netlify/functions/score', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64Jpeg }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      data && typeof data.error === 'string' ? data.error : 'The scoring went wrong. Try again.';
    throw new Error(message);
  }
  return data as ScoreResult;
}
