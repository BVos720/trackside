/**
 * A log you can read on the phone, including the run that died.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * The app is built on EAS from Windows and carried on an iPhone. There is no
 * Mac, so no Xcode console; a `preview` build has no Metro attached, so
 * `console.log` goes nowhere a person can see. And the crash that prompted
 * this is a C++ throw inside MapLibre: it takes the process with it, leaving
 * no JS stack, no red box, and nothing for `ErrorBoundary` to catch.
 *
 * What is actually needed in that situation is the handful of lines written
 * *just before* the process died. So this keeps a small ring buffer and
 * writes it to disk as it goes; on the next launch the previous run's tail is
 * still there, which is the only record of what happened.
 *
 * Writes are synchronous by design. `File.write` blocks, and that is the
 * point: an async write scheduled a moment before `abort()` never lands, and
 * a log that loses the last line before a crash is a log that omits the
 * answer.
 */
import { Directory, File, Paths } from 'expo-file-system';

/**
 * How many lines are kept.
 *
 * Small deliberately. The whole buffer is rewritten on every flush, so this
 * trades directly against how much work each log line costs — and the useful
 * window before a crash is the last few dozen lines, not the last few
 * thousand.
 */
const MAX_LINES = 400;

/** Longest single entry, so one enormous object cannot fill the buffer. */
const MAX_ENTRY = 2000;

const DIR = 'diagnostics';
const CURRENT = 'current.log';
const PREVIOUS = 'previous.log';

let lines: string[] = [];
let previousRun: string | null = null;
let installed = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let writable = true;

function dir(): Directory {
  const d = new Directory(Paths.document, DIR);
  if (!d.exists) d.create({ intermediates: true });
  return d;
}

function file(name: string): File {
  return new File(dir(), name);
}

/**
 * Write the buffer out now.
 *
 * Failures are swallowed and disable further writing rather than propagating.
 * A diagnostic tool that can crash the app it is diagnosing is worse than no
 * diagnostic tool, and the in-memory buffer still works for the current run.
 */
export function flushLog(): void {
  if (!writable) return;
  try {
    const f = file(CURRENT);
    if (!f.exists) f.create();
    f.write(lines.join('\n'));
  } catch {
    writable = false;
  }
}

function scheduleFlush(immediate: boolean): void {
  if (immediate) {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flushLog();
    return;
  }
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushLog();
  }, 400);
}

function stamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function render(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value);
  } catch {
    // Circular, or something that refuses to serialise. Its type is still
    // more useful than losing the line entirely.
    return Object.prototype.toString.call(value);
  }
}

/**
 * Add a line.
 *
 * Warnings and errors flush immediately; ordinary lines are batched. The
 * asymmetry is deliberate — a warning is often the last thing written before
 * something goes wrong, and that is precisely the line worth not losing.
 */
export function logLine(level: string, ...parts: unknown[]): void {
  let text = parts.map(render).join(' ');
  if (text.length > MAX_ENTRY) text = `${text.slice(0, MAX_ENTRY)}… (truncated)`;

  lines.push(`${stamp()} ${level.toUpperCase()} ${text}`);
  if (lines.length > MAX_LINES) lines = lines.slice(-MAX_LINES);

  scheduleFlush(level === 'warn' || level === 'error');
}

/**
 * Take the last run's log and start a fresh one.
 *
 * Called once at startup, before anything can log. Reading is asynchronous
 * because nothing depends on it being ready — the previous run's log is only
 * looked at when somebody opens the diagnostics screen.
 */
export async function rotateLog(): Promise<void> {
  try {
    const current = file(CURRENT);
    if (current.exists) {
      const text = await current.text();
      previousRun = text.length > 0 ? text : null;
      const prev = file(PREVIOUS);
      if (prev.exists) prev.delete();
      current.copy(prev);
      current.write('');
    }
  } catch {
    // A missing or unreadable log is not worth reporting. It only means this
    // is the first run, or the last one never got to write anything.
    previousRun = null;
  }
}

/** The log from the run before this one — what a crash left behind. */
export async function readPreviousLog(): Promise<string | null> {
  if (previousRun !== null) return previousRun;
  try {
    const prev = file(PREVIOUS);
    if (!prev.exists) return null;
    const text = await prev.text();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

/** This run so far, newest last. */
export function readCurrentLog(): string {
  return lines.join('\n');
}

export function clearLogs(): void {
  lines = [];
  previousRun = null;
  try {
    for (const name of [CURRENT, PREVIOUS]) {
      const f = file(name);
      if (f.exists) f.delete();
    }
  } catch {
    // Nothing to do. The buffer is cleared either way.
  }
}

/**
 * Route `console` through the buffer as well as its usual destination.
 *
 * Chained rather than replaced, so Metro still shows everything during
 * development and this is purely additive. Recursion is impossible because
 * the originals are captured before the patch is installed.
 */
export function installLogCapture(): void {
  if (installed) return;
  installed = true;

  const levels = ['log', 'info', 'warn', 'error'] as const;
  const target = console as unknown as Record<string, (...args: unknown[]) => void>;

  for (const level of levels) {
    const original = target[level]?.bind(console);
    target[level] = (...args: unknown[]) => {
      try {
        logLine(level, ...args);
      } catch {
        // Never let logging break the thing being logged.
      }
      original?.(...args);
    };
  }
}
