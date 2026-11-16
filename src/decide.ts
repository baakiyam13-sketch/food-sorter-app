// Small pure helpers: the healthy/junk decision, the board command, and
// cleaning up the board address typed in Settings.

export type Side = 'healthy' | 'junk';

// A score at or above the threshold is healthy, otherwise junk.
export function verdictForScore(score: number, threshold: number): Side {
  return score >= threshold ? 'healthy' : 'junk';
}

export interface SortCommand {
  method: 'POST';
  url: string;
  body: { side: Side; score: number };
}

// The exact request that would go to the board, e.g.
// POST http://192.168.43.50/sort  {"side":"healthy","score":7}
export function buildSortCommand(address: string, side: Side, score: number): SortCommand {
  return {
    method: 'POST',
    url: `http://${cleanAddress(address)}/sort`,
    body: { side, score },
  };
}

// Accept an IP like 192.168.43.50 or a hostname like food-sorter.local.
// Strip any http:// (or https://) and any trailing slash.
export function cleanAddress(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
}
