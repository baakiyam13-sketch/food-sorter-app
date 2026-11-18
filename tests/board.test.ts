import { describe, expect, it } from 'vitest';
import { PretendBoard, sendWithRetry } from '../src/board';

// A short busy time keeps these tests fast; the app uses the real 2 seconds.
const BUSY_MS = 120;

function makeBoard() {
  return new PretendBoard({ address: '192.168.43.50', busyMs: BUSY_MS });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('PretendBoard', () => {
  it('answers status like the real board', async () => {
    const board = makeBoard();
    const reply = await board.status();
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({
      ok: true,
      busy: false,
      position: 'center',
      last: 'none',
      wifi: 'sta',
      ip: '192.168.43.50',
      name: 'food-sorter',
    });
  });

  it('accepts a sort and becomes busy', async () => {
    const board = makeBoard();
    const reply = await board.sort('healthy', 7);
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ ok: true, busy: true, side: 'healthy' });

    const status = await board.status();
    expect(status.body.busy).toBe(true);
    expect(status.body.position).toBe('healthy');
  });

  it('returns the paddle to the middle by itself and remembers the last sort', async () => {
    const board = makeBoard();
    await board.sort('junk', 2);
    await sleep(BUSY_MS + 60);

    const status = await board.status();
    expect(status.body.busy).toBe(false);
    expect(status.body.position).toBe('center');
    expect(status.body.last).toBe('junk');
  });

  it('replies 409 busy to a sort while the paddle is moving', async () => {
    const board = makeBoard();
    await board.sort('healthy', 7);
    const second = await board.sort('junk', 2);
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ ok: false, busy: true, error: 'busy' });
  });

  it('replies 409 busy to center while the paddle is moving', async () => {
    const board = makeBoard();
    await board.sort('healthy', 7);
    const center = await board.center();
    expect(center.status).toBe(409);
    expect(center.body).toEqual({ ok: false, busy: true, error: 'busy' });
  });

  it('replies 400 bad side to a missing or unknown side, even while busy', async () => {
    const board = makeBoard();
    await board.sort('healthy', 7);

    const unknown = await board.sort('sideways', 5);
    expect(unknown.status).toBe(400);
    expect(unknown.body).toEqual({ ok: false, busy: false, error: 'bad side' });

    const empty = await board.sort('', 5);
    expect(empty.status).toBe(400);
  });

  it('understands left/right words and ignores letter case and spaces', async () => {
    const board = makeBoard();
    const left = await board.sort(' Left ', 8);
    expect(left.status).toBe(200);
    expect(left.body.side).toBe('healthy');
  });

  it('centers when idle with 200 and does not clear the last sort', async () => {
    const board = makeBoard();
    await board.sort('junk', 2);
    await sleep(BUSY_MS + 60);

    const center = await board.center();
    expect(center.status).toBe(200);
    expect(center.body).toEqual({ ok: true, busy: false, side: 'center' });

    const status = await board.status();
    expect(status.body.last).toBe('junk');
  });
});

describe('sendWithRetry', () => {
  it('passes a clean reply straight through', async () => {
    const board = makeBoard();
    const reply = await sendWithRetry(() => board.sort('healthy', 7));
    expect(reply.status).toBe(200);
  });

  it('waits and sends again on a 409 busy reply until the board is free', async () => {
    const board = makeBoard();
    await board.sort('healthy', 7); // occupy the board

    let tries = 0;
    const reply = await sendWithRetry(
      async () => {
        tries += 1;
        return board.sort('junk', 2);
      },
      { waitMs: 40, timeoutMs: 2000 },
    );
    expect(reply.status).toBe(200);
    expect(reply.body.side).toBe('junk');
    expect(tries).toBeGreaterThan(1);
  });

  it('also retries when the body says error busy without a 409 status', async () => {
    let calls = 0;
    const reply = await sendWithRetry(
      async () => {
        calls += 1;
        if (calls < 3) return { status: 200, body: { ok: false, busy: true, error: 'busy' } };
        return { status: 200, body: { ok: true, busy: true, side: 'healthy' } };
      },
      { waitMs: 10, timeoutMs: 2000 },
    );
    expect(reply.body.ok).toBe(true);
    expect(calls).toBe(3);
  });

  it('gives up after about 3 seconds if the board stays busy', async () => {
    const stuck = () => Promise.resolve({ status: 409, body: { ok: false, busy: true, error: 'busy' } });
    const start = Date.now();
    const reply = await sendWithRetry(stuck, { waitMs: 50, timeoutMs: 300 });
    expect(reply.status).toBe(409);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
