import { describe, expect, it } from 'vitest';
import { sendWithRetry } from '../src/board';
import { BleBoard, buildBleCommand, parseReply, type BleLink } from '../src/ble';

// A fake link: records what the phone writes and lets a test play the board.
class FakeLink implements BleLink {
  connected = true;
  name = 'food-sorter';
  written: string[] = [];
  reconnects = 0;
  reconnectFails = false;
  private onReply: (t: string) => void = () => {};
  private onDisconnect: () => void = () => {};
  // What the fake board answers to each write; a function so tests can script it.
  answer: (command: string) => string | null = () => null;

  async write(text: string) {
    this.written.push(text);
    const reply = this.answer(text);
    if (reply !== null) queueMicrotask(() => this.onReply(reply));
  }
  setReplyHandler(h: (t: string) => void) {
    this.onReply = h;
  }
  setDisconnectHandler(h: () => void) {
    this.onDisconnect = h;
  }
  async reconnect() {
    this.reconnects++;
    if (this.reconnectFails) throw new Error('gone');
    this.connected = true;
  }
  disconnect() {
    this.connected = false;
  }
  // Test helpers
  emit(text: string) {
    this.onReply(text);
  }
  drop() {
    this.connected = false;
    this.onDisconnect();
  }
}

async function connected(link = new FakeLink(), timeoutMs = 3000) {
  const board = new BleBoard(async () => link, { replyTimeoutMs: timeoutMs });
  await board.connect();
  return { board, link };
}

describe('buildBleCommand', () => {
  it('builds the text written to the board', () => {
    expect(buildBleCommand('healthy', 9)).toBe('sort healthy 9');
    expect(buildBleCommand('junk', 2)).toBe('sort junk 2');
  });
});

describe('parseReply', () => {
  it('maps OK replies to 200', () => {
    expect(parseReply('OK sort healthy')).toEqual({
      status: 200,
      body: { ok: true, busy: true, side: 'healthy' },
    });
    expect(parseReply('OK sort junk').body.side).toBe('junk');
    expect(parseReply('OK center')).toEqual({
      status: 200,
      body: { ok: true, busy: false, side: 'center' },
    });
  });

  it('maps ERR busy to 409 and ERR bad side to 400, like the HTTP contract', () => {
    expect(parseReply('ERR busy')).toEqual({
      status: 409,
      body: { ok: false, busy: true, error: 'busy' },
    });
    expect(parseReply('ERR bad side')).toEqual({
      status: 400,
      body: { ok: false, busy: false, error: 'bad side' },
    });
  });

  it('reads a status reply', () => {
    const reply = parseReply('ST 1 healthy none');
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ busy: true, position: 'healthy', last: 'none' });
    expect(parseReply('ST 0 center junk').body).toMatchObject({
      busy: false,
      position: 'center',
      last: 'junk',
    });
  });

  it('copes with stray spaces and refuses anything it does not know', () => {
    expect(parseReply(' OK   center \n').status).toBe(200);
    expect(() => parseReply('HELLO')).toThrow(/does not understand/);
    expect(() => parseReply('')).toThrow();
    expect(() => parseReply('OK sort purple')).toThrow();
    expect(() => parseReply('ST 2 center none')).toThrow();
  });
});

describe('BleBoard', () => {
  it('writes the command and returns the parsed reply', async () => {
    const { board, link } = await connected();
    link.answer = () => 'OK sort healthy';
    const reply = await board.sort('healthy', 9);
    expect(link.written).toEqual(['sort healthy 9']);
    expect(reply.status).toBe(200);
  });

  it('sends status and center as plain words', async () => {
    const { board, link } = await connected();
    link.answer = (c) => (c === 'status' ? 'ST 0 center none' : 'OK center');
    expect((await board.status()).body.position).toBe('center');
    expect((await board.center()).body.side).toBe('center');
    expect(link.written).toEqual(['status', 'center']);
  });

  it('ignores DONE and READY, which do not answer a command', async () => {
    const { board, link } = await connected();
    link.answer = () => null;
    const pending = board.sort('junk', 3);
    await Promise.resolve();
    link.emit('DONE healthy');
    link.emit('READY');
    link.emit('OK sort junk');
    expect((await pending).body.side).toBe('junk');
  });

  it('sends one command at a time, in order', async () => {
    const { board, link } = await connected();
    const order: string[] = [];
    link.answer = (c) => {
      order.push(c);
      return c === 'status' ? 'ST 1 junk none' : 'OK sort junk';
    };
    const a = board.sort('junk', 1);
    const b = board.status();
    const [ra, rb] = await Promise.all([a, b]);
    expect(order).toEqual(['sort junk 1', 'status']);
    expect(ra.body.side).toBe('junk');
    expect(rb.body.busy).toBe(true);
  });

  it('works with the shared busy-retry logic: 409 then 200', async () => {
    const { board, link } = await connected();
    let tries = 0;
    link.answer = () => (++tries < 3 ? 'ERR busy' : 'OK sort healthy');
    const reply = await sendWithRetry(() => board.sort('healthy', 8), {
      waitMs: 1,
      timeoutMs: 1000,
    });
    expect(reply.status).toBe(200);
    expect(tries).toBe(3);
  });

  it('gives a clear error when the board does not answer', async () => {
    const { board } = await connected(new FakeLink(), 30);
    await expect(board.sort('healthy', 7)).rejects.toThrow(/did not answer/);
  });

  it('a timed-out command does not block the next one', async () => {
    const { board, link } = await connected(new FakeLink(), 30);
    await expect(board.status()).rejects.toThrow(/did not answer/);
    link.answer = () => 'ST 0 center none';
    expect((await board.status()).status).toBe(200);
  });

  it('fails the waiting command when Bluetooth drops', async () => {
    const { board, link } = await connected();
    const pending = board.sort('junk', 1);
    await Promise.resolve();
    link.drop();
    await expect(pending).rejects.toThrow(/connection to the board was lost/);
    expect(board.connected).toBe(false);
    await expect(board.status()).rejects.toThrow(/not connected/);
  });

  it('turns a write failure into an error', async () => {
    const { board, link } = await connected();
    link.write = async () => {
      throw new Error('GATT write failed');
    };
    await expect(board.sort('junk', 1)).rejects.toThrow('GATT write failed');
  });

  it('refuses to send before a board is connected', async () => {
    const board = new BleBoard(async () => new FakeLink());
    await expect(board.sort('junk', 1)).rejects.toThrow(/not connected/);
    await expect(board.ensureConnected()).rejects.toThrow(/Connect the board first/);
  });

  it('reconnects quietly to the same board without the chooser', async () => {
    let chooserOpened = 0;
    const link = new FakeLink();
    const board = new BleBoard(async () => {
      chooserOpened++;
      return link;
    });
    await board.connect();
    link.drop();
    expect(board.connected).toBe(false);
    await board.ensureConnected();
    expect(board.connected).toBe(true);
    expect(link.reconnects).toBe(1);
    expect(chooserOpened).toBe(1);
  });

  it('explains what to do when the board cannot be reached again', async () => {
    const { board, link } = await connected();
    link.drop();
    link.reconnectFails = true;
    await expect(board.ensureConnected()).rejects.toThrow(/Cannot reach the board/);
  });

  it('opens the chooser again if a quiet reconnect fails during Connect', async () => {
    let chooserOpened = 0;
    const first = new FakeLink();
    const second = new FakeLink();
    const board = new BleBoard(async () => (++chooserOpened === 1 ? first : second));
    await board.connect();
    first.drop();
    first.reconnectFails = true;
    await board.connect();
    expect(chooserOpened).toBe(2);
    expect(board.connected).toBe(true);
  });

  it('tells listeners when the connection changes', async () => {
    const link = new FakeLink();
    const board = new BleBoard(async () => link);
    let calls = 0;
    const stop = board.subscribe(() => calls++);
    await board.connect();
    link.drop();
    expect(calls).toBe(2);
    stop();
    board.disconnect();
    expect(calls).toBe(2);
  });
});
