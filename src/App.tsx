import { useEffect, useRef, useState } from 'react';
import { scorePhoto, type ScoreResult } from './ai';
import { PretendBoard, sendWithRetry, type BoardReply } from './board';
import { buildSortCommand, cleanAddress, verdictForScore, type Side, type SortCommand } from './decide';
import { dataUrlToBase64, fileToJpeg, makeThumb } from './photo';
import {
  addLogEntry,
  clearLog,
  loadLog,
  loadSettings,
  saveSettings,
  type LogEntry,
  type Settings,
} from './storage';

type View = 'scan' | 'result' | 'log' | 'settings';

interface ResultState {
  result: ScoreResult;
  verdict: Side | null; // null when the photo had no food
  command: SortCommand | null;
  commandText: string | null;
}

function commandToText(command: SortCommand): string {
  return `${command.method} ${command.url}\n${JSON.stringify(command.body)}`;
}

export default function App() {
  const [view, setView] = useState<View>('scan');
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResultState | null>(null);
  const [log, setLog] = useState<LogEntry[]>(loadLog);

  // One pretend board for the whole app, rebuilt only if the address changes.
  const boardRef = useRef<{ address: string; board: PretendBoard } | null>(null);
  if (!boardRef.current || boardRef.current.address !== settings.boardAddress) {
    boardRef.current = {
      address: settings.boardAddress,
      board: new PretendBoard({ address: cleanAddress(settings.boardAddress) }),
    };
  }
  const board = boardRef.current.board;

  const [boardReply, setBoardReply] = useState<BoardReply | null>(null);
  const [boardStatus, setBoardStatus] = useState<Record<string, unknown> | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);

  // Keep the pretend board's status fresh while it is on screen.
  useEffect(() => {
    if (view !== 'result' || !result?.command) return;
    let stopped = false;
    const tick = async () => {
      const reply = await board.status();
      if (!stopped) setBoardStatus(reply.body);
    };
    tick();
    const timer = setInterval(tick, 300);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [view, result, board]);

  async function onPhotoPicked(file: File) {
    setBusy(true);
    setError(null);
    setBoardReply(null);
    setBoardStatus(null);
    try {
      const jpegDataUrl = await fileToJpeg(file, 768);
      const scored = await scorePhoto(dataUrlToBase64(jpegDataUrl));
      const thumb = await makeThumb(jpegDataUrl, 96);

      let verdict: Side | null = null;
      let command: SortCommand | null = null;
      let commandText: string | null = null;

      if (scored.isFood) {
        // The app, not the AI, decides healthy or junk.
        verdict = verdictForScore(scored.score, settings.threshold);
        command = buildSortCommand(settings.boardAddress, verdict, scored.score);
        commandText = commandToText(command);
        // Send to the (pretend) board, retrying while it is busy.
        const reply = await sendWithRetry(() => board.sort(verdict!, scored.score));
        setBoardReply(reply);
      }

      setResult({ result: scored, verdict, command, commandText });
      setLog(
        addLogEntry({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          time: new Date().toISOString(),
          thumb,
          isFood: scored.isFood,
          item: scored.item,
          score: scored.isFood ? scored.score : null,
          verdict: verdict ?? 'not food',
          command: commandText,
        }),
      );
      setView('result');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Sent straight away, without the retry helper, so the 409 busy reply
  // can be seen while the paddle is still moving.
  async function sendAgain() {
    if (!result?.command) return;
    const reply = await board.sort(result.command.body.side, result.command.body.score);
    setBoardReply(reply);
  }

  function onSaveSettings(next: Settings) {
    setSettings(next);
    saveSettings(next);
  }

  function onClearLog() {
    clearLog();
    setLog([]);
  }

  return (
    <main className="app">
      <h1 className="app-title">Food Sorter</h1>
      {view === 'scan' && (
        <ScanScreen
          busy={busy}
          error={error}
          inputRef={fileInput}
          onPhotoPicked={onPhotoPicked}
          onShowLog={() => setView('log')}
          onShowSettings={() => setView('settings')}
        />
      )}
      {view === 'result' && result && (
        <ResultScreen
          result={result}
          boardReply={boardReply}
          boardStatus={boardStatus}
          onSendAgain={sendAgain}
          onScanAnother={() => setView('scan')}
        />
      )}
      {view === 'log' && <LogScreen log={log} onBack={() => setView('scan')} />}
      {view === 'settings' && (
        <SettingsScreen
          settings={settings}
          onSave={onSaveSettings}
          onClearLog={onClearLog}
          onBack={() => setView('scan')}
        />
      )}
    </main>
  );
}

function ScanScreen(props: {
  busy: boolean;
  error: string | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onPhotoPicked: (file: File) => void;
  onShowLog: () => void;
  onShowSettings: () => void;
}) {
  return (
    <section className="screen">
      <p className="hint">Take a photo of the food only</p>
      <button
        className="big-button"
        disabled={props.busy}
        onClick={() => props.inputRef.current?.click()}
      >
        {props.busy ? 'Looking at your photo…' : '📷 Take a photo'}
      </button>
      <input
        ref={props.inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) props.onPhotoPicked(file);
        }}
      />
      {props.error && <p className="error">{props.error}</p>}
      <div className="row">
        <button className="plain-button" onClick={props.onShowLog}>
          Log
        </button>
        <button className="plain-button" onClick={props.onShowSettings}>
          Settings
        </button>
      </div>
    </section>
  );
}

function ResultScreen(props: {
  result: ResultState;
  boardReply: BoardReply | null;
  boardStatus: Record<string, unknown> | null;
  onSendAgain: () => void;
  onScanAnother: () => void;
}) {
  const { result } = props;

  if (!result.result.isFood) {
    return (
      <section className="screen">
        <div className="face face-unknown">🤔</div>
        <p className="big-text">I can't see any food, try again</p>
        <p className="reason">{result.result.reason}</p>
        <button className="big-button" onClick={props.onScanAnother}>
          Scan another
        </button>
      </section>
    );
  }

  const healthy = result.verdict === 'healthy';
  return (
    <section className="screen">
      <div className={`face ${healthy ? 'face-healthy' : 'face-junk'}`}>
        {healthy ? '😀' : '😞'}
      </div>
      <p className="score">
        {result.result.score} / 10
      </p>
      <p className="big-text">{result.result.item}</p>
      <p className="reason">{result.result.reason}</p>

      {result.commandText && (
        <div className="card">
          <h2>Command for the board</h2>
          <pre className="code">{result.commandText}</pre>
        </div>
      )}

      <PretendBoardPanel
        status={props.boardStatus}
        reply={props.boardReply}
        onSendAgain={props.onSendAgain}
      />

      <button className="big-button" onClick={props.onScanAnother}>
        Scan another
      </button>
    </section>
  );
}

function PretendBoardPanel(props: {
  status: Record<string, unknown> | null;
  reply: BoardReply | null;
  onSendAgain: () => void;
}) {
  const position = (props.status?.position as string) ?? 'center';
  const led =
    position === 'healthy' ? 'led-green' : position === 'junk' ? 'led-red' : 'led-off';
  return (
    <div className="card">
      <h2>Pretend board</h2>
      <div className="board">
        <div className="bins">
          <div className="bin bin-healthy">Healthy</div>
          <div className={`paddle paddle-${position}`} aria-hidden="true" />
          <div className="bin bin-junk">Junk</div>
        </div>
        <div className={`led ${led}`} title="LED" />
      </div>
      {props.reply && (
        <>
          <h3>Board reply ({props.reply.status})</h3>
          <pre className="code">{JSON.stringify(props.reply.body)}</pre>
        </>
      )}
      <button className="plain-button" onClick={props.onSendAgain}>
        Send again now
      </button>
    </div>
  );
}

function LogScreen(props: { log: LogEntry[]; onBack: () => void }) {
  const healthyCount = props.log.filter((e) => e.verdict === 'healthy').length;
  const junkCount = props.log.filter((e) => e.verdict === 'junk').length;
  return (
    <section className="screen">
      <h2>Log</h2>
      <p className="big-text">
        Healthy: {healthyCount} &nbsp; Junk: {junkCount}
      </p>
      {props.log.length === 0 && <p className="hint">No scans yet.</p>}
      <ul className="log-list">
        {props.log.map((entry) => (
          <li key={entry.id} className="log-entry">
            <img className="thumb" src={entry.thumb} alt="" width={48} height={48} />
            <div className="log-text">
              <p>
                <strong>{entry.isFood ? entry.item : 'Not food'}</strong>
                {entry.score !== null && ` — ${entry.score}/10 ${entry.verdict}`}
              </p>
              <p className="log-time">{new Date(entry.time).toLocaleString()}</p>
              {entry.command && <pre className="code code-small">{entry.command}</pre>}
            </div>
          </li>
        ))}
      </ul>
      <button className="plain-button" onClick={props.onBack}>
        Back
      </button>
    </section>
  );
}

function SettingsScreen(props: {
  settings: Settings;
  onSave: (next: Settings) => void;
  onClearLog: () => void;
  onBack: () => void;
}) {
  const [address, setAddress] = useState(props.settings.boardAddress);
  const [threshold, setThreshold] = useState(String(props.settings.threshold));

  function save() {
    const clean = cleanAddress(address);
    const n = Number(threshold);
    props.onSave({
      boardAddress: clean || props.settings.boardAddress,
      threshold: Number.isInteger(n) && n >= 0 && n <= 10 ? n : props.settings.threshold,
      boardMode: 'pretend',
    });
    setAddress(clean || props.settings.boardAddress);
    props.onBack();
  }

  return (
    <section className="screen">
      <h2>Settings</h2>
      <label className="field">
        <span>Board address</span>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="food-sorter.local"
          autoCapitalize="off"
          autoCorrect="off"
        />
      </label>
      <p className="note">
        Android often can't find food-sorter.local. Type the board's IP. You can find it in
        your phone's hotspot settings under connected devices, or count the green LED blinks
        for the last number.
      </p>
      <label className="field">
        <span>Healthy threshold (0–10)</span>
        <input
          type="number"
          min={0}
          max={10}
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
        />
      </label>
      <fieldset className="field">
        <legend>Board mode</legend>
        <label className="radio">
          <input type="radio" name="board-mode" checked readOnly /> Pretend
        </label>
        <label className="radio radio-disabled">
          <input type="radio" name="board-mode" disabled /> Real (Phase 2)
        </label>
      </fieldset>
      <div className="row">
        <button className="plain-button" onClick={props.onClearLog}>
          Clear log
        </button>
        <button className="big-button" onClick={save}>
          Save
        </button>
      </div>
      <button className="plain-button" onClick={props.onBack}>
        Back
      </button>
    </section>
  );
}
