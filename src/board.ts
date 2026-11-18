// The board client. The app only ever talks to a BoardClient, so the pretend
// board (here) and the real Bluetooth board (ble.ts) are interchangeable.
//
// Every method returns an HTTP-ish reply: { status, body }. The pretend board
// follows the board's contract exactly, including the 400/409 error replies,
// and the Bluetooth board turns the ESP32's short text replies into the same shape.

import type { Side } from './decide';

export interface BoardReply {
  status: number;
  body: Record<string, unknown>;
}

export interface BoardClient {
  status(): Promise<BoardReply>;
  sort(side: string, score: number): Promise<BoardReply>;
  center(): Promise<BoardReply>;
}

// Words the board understands for /sort (see the firmware README).
const SIDE_WORDS: Record<string, Side> = {
  healthy: 'healthy',
  left: 'healthy',
  junk: 'junk',
  right: 'junk',
};
const CENTER_WORDS = new Set(['center', 'middle', 'reset']);

const DEFAULT_BUSY_MS = 2000; // the real board is busy for about 2 seconds

export interface PretendBoardOptions {
  address: string; // shown in the /status reply, for display only
  busyMs?: number; // tests can make this short
}

// A pretend board that stands in for the real ESP32 when no board is connected.
// It keeps the same state the firmware does: busy, position, last, and
// which LED would be on.
export class PretendBoard implements BoardClient {
  private busyUntil = 0;
  private position: 'center' | Side = 'center';
  private last: 'none' | Side = 'none';
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private opts: PretendBoardOptions) {}

  private get busyMs(): number {
    return this.opts.busyMs ?? DEFAULT_BUSY_MS;
  }

  private isBusy(): boolean {
    return Date.now() < this.busyUntil;
  }

  async status(): Promise<BoardReply> {
    return {
      status: 200,
      body: {
        ok: true,
        busy: this.isBusy(),
        position: this.isBusy() ? this.position : 'center',
        last: this.last,
        wifi: 'sta',
        ip: this.opts.address,
        name: 'food-sorter',
      },
    };
  }

  async sort(side: string, _score: number): Promise<BoardReply> {
    const word = (side ?? '').trim().toLowerCase();
    if (CENTER_WORDS.has(word)) return this.center();
    const realSide = SIDE_WORDS[word];
    // A missing or unknown side wins over busy: 400 {"error":"bad side"}.
    if (!realSide) {
      return { status: 400, body: { ok: false, busy: false, error: 'bad side' } };
    }
    if (this.isBusy()) {
      return { status: 409, body: { ok: false, busy: true, error: 'busy' } };
    }
    this.startSort(realSide);
    return { status: 200, body: { ok: true, busy: true, side: realSide } };
  }

  async center(): Promise<BoardReply> {
    if (this.isBusy()) {
      return { status: 409, body: { ok: false, busy: true, error: 'busy' } };
    }
    this.position = 'center';
    return { status: 200, body: { ok: true, busy: false, side: 'center' } };
  }

  private startSort(side: Side): void {
    this.position = side;
    this.busyUntil = Date.now() + this.busyMs;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      // The board returns the paddle to the middle by itself.
      this.position = 'center';
      this.busyUntil = 0;
      this.last = side;
    }, this.busyMs);
  }
}

export interface RetryOptions {
  waitMs?: number; // wait between tries, about 500 ms
  timeoutMs?: number; // give up after about 3 seconds
  sleep?: (ms: number) => Promise<void>; // tests can skip real waiting
}

// Shared busy-retry logic, written once for both boards.
// On a 409 or an "error":"busy" reply, wait about 500 ms and send the same
// command again, for up to about 3 seconds. Never sends the next item
// while the board is busy.
export async function sendWithRetry(
  send: () => Promise<BoardReply>,
  opts: RetryOptions = {},
): Promise<BoardReply> {
  const waitMs = opts.waitMs ?? 500;
  const timeoutMs = opts.timeoutMs ?? 3000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const start = Date.now();
  let reply = await send();
  while ((reply.status === 409 || reply.body.error === 'busy') && Date.now() - start < timeoutMs) {
    await sleep(waitMs);
    reply = await send();
  }
  return reply;
}
