// The Bluetooth board client (Phase 2). The phone talks to the ESP32 over
// Bluetooth Low Energy: it writes a short text command and the board answers
// with a short text notification. See esp32/food-sorter/README.md in the
// microcontroller-projects repository for the full protocol.
//
// This file has no browser code in it, so it is unit-tested with a fake link.
// The real Web Bluetooth link lives in webbluetooth.ts.

import type { BoardClient, BoardReply } from './board';
import type { Side } from './decide';

// These must match src/config.h in the firmware. Change both together.
export const BLE_DEVICE_NAME = 'food-sorter';
export const BLE_SERVICE_UUID = 'f00d0001-5047-4e53-8f0d-534f52544552';
export const BLE_COMMAND_UUID = 'f00d0002-5047-4e53-8f0d-534f52544552';
export const BLE_REPLY_UUID = 'f00d0003-5047-4e53-8f0d-534f52544552';

// The text written to the board, e.g. "sort healthy 9".
export function buildBleCommand(side: Side, score: number): string {
  return `sort ${side} ${score}`;
}

// Turn the board's short text reply into the same { status, body } the
// pretend board gives, so the screens and the busy-retry logic do not care
// which board they are talking to.
//   OK sort healthy | OK sort junk | OK center
//   ERR busy | ERR bad side
//   ST <busy 0/1> <position> <last>
export function parseReply(text: string): BoardReply {
  const words = text.trim().split(/\s+/);
  const [kind, a, b, c] = words;
  if (kind === 'OK' && a === 'sort' && (b === 'healthy' || b === 'junk')) {
    return { status: 200, body: { ok: true, busy: true, side: b } };
  }
  if (kind === 'OK' && a === 'center') {
    return { status: 200, body: { ok: true, busy: false, side: 'center' } };
  }
  if (kind === 'ERR' && a === 'busy') {
    return { status: 409, body: { ok: false, busy: true, error: 'busy' } };
  }
  if (kind === 'ERR' && a === 'bad' && b === 'side') {
    return { status: 400, body: { ok: false, busy: false, error: 'bad side' } };
  }
  if (kind === 'ST' && (a === '0' || a === '1') && b && c) {
    return {
      status: 200,
      body: { ok: true, busy: a === '1', position: b, last: c, name: BLE_DEVICE_NAME },
    };
  }
  throw new Error(`The board sent a reply the app does not understand: "${text}"`);
}

// One open Bluetooth connection to the board.
export interface BleLink {
  readonly connected: boolean;
  readonly name: string;
  write(text: string): Promise<void>;
  setReplyHandler(handler: (text: string) => void): void;
  setDisconnectHandler(handler: () => void): void;
  reconnect(): Promise<void>; // same board again, no device chooser
  disconnect(): void;
}

// Opens the browser's "choose a device" box and connects to the board.
export type LinkFactory = () => Promise<BleLink>;

export interface BleBoardOptions {
  replyTimeoutMs?: number; // how long to wait for an answer, about 3 seconds
}

export class BleBoard implements BoardClient {
  private link: BleLink | null = null;
  private pending: { resolve: (r: BoardReply) => void; reject: (e: Error) => void } | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();

  constructor(
    private openLink: LinkFactory,
    private opts: BleBoardOptions = {},
  ) {}

  get connected(): boolean {
    return this.link?.connected ?? false;
  }

  get deviceName(): string | null {
    return this.link?.name ?? null;
  }

  // Be told when the connection comes or goes. Returns a function that stops listening.
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyChange(): void {
    this.listeners.forEach((l) => l());
  }

  // Must be called from a tap: the browser shows its device chooser.
  async connect(): Promise<void> {
    if (this.link && !this.link.connected) {
      try {
        await this.link.reconnect();
        this.notifyChange();
        return;
      } catch {
        // The board may have been switched off; fall through to the chooser.
      }
    }
    this.link?.disconnect();
    const link = await this.openLink();
    link.setReplyHandler((text) => this.onReply(text));
    link.setDisconnectHandler(() => {
      this.failPending(new Error('The Bluetooth connection to the board was lost.'));
      this.notifyChange();
    });
    this.link = link;
    this.notifyChange();
  }

  // Before scanning: make sure the board is connected, reconnecting quietly
  // to the same board if the link dropped. No chooser, so no tap is needed.
  async ensureConnected(): Promise<void> {
    if (this.connected) return;
    if (!this.link) throw new Error('Connect the board first (Settings, Connect board).');
    try {
      await this.link.reconnect();
    } catch {
      throw new Error('Cannot reach the board. Switch it on, stand close to it, then tap Connect board in Settings.');
    }
    this.notifyChange();
  }

  disconnect(): void {
    this.link?.disconnect();
    this.link = null;
    this.failPending(new Error('Disconnected from the board.'));
    this.notifyChange();
  }

  status(): Promise<BoardReply> {
    return this.request('status');
  }

  sort(side: string, score: number): Promise<BoardReply> {
    return this.request(`sort ${side} ${score}`);
  }

  center(): Promise<BoardReply> {
    return this.request('center');
  }

  // One command at a time: write it, then wait for the board's answer.
  private request(command: string): Promise<BoardReply> {
    const run = () => this.exchange(command);
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => undefined);
    return result;
  }

  private exchange(command: string): Promise<BoardReply> {
    const link = this.link;
    if (!link || !link.connected) {
      return Promise.reject(new Error('The board is not connected.'));
    }
    return new Promise<BoardReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error('The board did not answer. Is it switched on and close by?'));
      }, this.opts.replyTimeoutMs ?? 3000);
      this.pending = {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      link.write(command).catch((err: Error) => this.failPending(err));
    });
  }

  private onReply(text: string): void {
    const t = text.trim();
    // "DONE healthy" arrives by itself when a sort finishes, and "READY" is the
    // value a fresh connection reads. Neither answers a command.
    if (t.startsWith('DONE') || t === 'READY') return;
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    try {
      pending.resolve(parseReply(t));
    } catch (err) {
      pending.reject(err as Error);
    }
  }

  private failPending(err: Error): void {
    const pending = this.pending;
    this.pending = null;
    pending?.reject(err);
  }
}
