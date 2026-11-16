// Settings and the scan log. No database and no accounts in this phase:
// both live in localStorage so they survive page reloads on the phone.

const SETTINGS_KEY = 'food-sorter-settings';
const LOG_KEY = 'food-sorter-log';
const LOG_CAP = 50;

export interface Settings {
  boardAddress: string;
  threshold: number;
  boardMode: 'pretend' | 'real';
}

export const DEFAULT_SETTINGS: Settings = {
  boardAddress: 'food-sorter.local',
  threshold: 6,
  boardMode: 'pretend',
};

export interface LogEntry {
  id: string;
  time: string; // ISO string
  thumb: string; // small JPEG data URL, about 96 px
  isFood: boolean;
  item: string;
  score: number | null;
  verdict: 'healthy' | 'junk' | 'not food';
  command: string | null; // the command that was (or would be) sent
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const saved = JSON.parse(raw) as Partial<Settings>;
    return {
      boardAddress:
        typeof saved.boardAddress === 'string' && saved.boardAddress.trim() !== ''
          ? saved.boardAddress
          : DEFAULT_SETTINGS.boardAddress,
      threshold:
        typeof saved.threshold === 'number' && saved.threshold >= 0 && saved.threshold <= 10
          ? saved.threshold
          : DEFAULT_SETTINGS.threshold,
      boardMode: saved.boardMode === 'real' ? 'real' : 'pretend',
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadLog(): LogEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (!raw) return [];
    const entries = JSON.parse(raw);
    return Array.isArray(entries) ? (entries as LogEntry[]) : [];
  } catch {
    return [];
  }
}

// Newest first, capped at about 50 entries.
export function addLogEntry(entry: LogEntry): LogEntry[] {
  const entries = [entry, ...loadLog()].slice(0, LOG_CAP);
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(entries));
  } catch {
    // localStorage can fill up on a cheap phone; drop old thumbs and retry once.
    const smaller = entries.slice(0, 25);
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(smaller));
    } catch {
      // Give up quietly: the scan itself still worked.
    }
    return smaller;
  }
  return entries;
}

export function clearLog(): void {
  localStorage.removeItem(LOG_KEY);
}
