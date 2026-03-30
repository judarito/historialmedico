import AsyncStorage from '@react-native-async-storage/async-storage';

const DIAGNOSTICS_LOGS_KEY = '@runtime_diagnostics/logs';
const DIAGNOSTICS_BOOT_KEY = '@runtime_diagnostics/boot';
const MAX_LOG_ENTRIES = 60;

export interface RuntimeDiagnosticEntry {
  id: string;
  at: string;
  severity: 'info' | 'error';
  source: string;
  message: string;
  stack?: string;
  extra?: string;
}

export interface BootSnapshot {
  sessionId: string;
  startedAt: string;
  updatedAt: string;
  status: 'booting' | 'ready' | 'failed';
  lastStep: string;
  lastError?: RuntimeDiagnosticEntry;
}

export interface RuntimeDiagnosticsReport {
  boot: BootSnapshot | null;
  entries: RuntimeDiagnosticEntry[];
}

interface CaptureOptions {
  isFatal?: boolean;
  extra?: unknown;
  markBootFailed?: boolean;
}

type RuntimeErrorListener = (entry: RuntimeDiagnosticEntry) => void;

const listeners = new Set<RuntimeErrorListener>();

function toId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeExtra(extra: unknown): string | undefined {
  if (extra == null) return undefined;
  if (typeof extra === 'string') return extra;
  try {
    return JSON.stringify(extra, null, 2);
  } catch {
    return String(extra);
  }
}

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // No-op: el diagnostico nunca debe tumbar la app.
  }
}

async function appendEntry(entry: RuntimeDiagnosticEntry): Promise<void> {
  const current = await readJson<RuntimeDiagnosticEntry[]>(DIAGNOSTICS_LOGS_KEY);
  const next = [entry, ...(current ?? [])].slice(0, MAX_LOG_ENTRIES);
  await writeJson(DIAGNOSTICS_LOGS_KEY, next);
}

function notifyListeners(entry: RuntimeDiagnosticEntry): void {
  listeners.forEach((listener) => {
    try {
      listener(entry);
    } catch {
      // No-op
    }
  });
}

export function subscribeToRuntimeErrors(listener: RuntimeErrorListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function normalizeError(error: unknown): { message: string; stack: string } {
  if (error instanceof Error) {
    return {
      message: error.message || error.name || 'Error desconocido',
      stack: error.stack ?? '',
    };
  }

  if (typeof error === 'string') {
    return { message: error, stack: '' };
  }

  return {
    message: 'Error desconocido',
    stack: safeExtra(error) ?? '',
  };
}

export async function getBootSnapshot(): Promise<BootSnapshot | null> {
  return readJson<BootSnapshot>(DIAGNOSTICS_BOOT_KEY);
}

export async function getDiagnosticsReport(): Promise<RuntimeDiagnosticsReport> {
  const [boot, entries] = await Promise.all([
    getBootSnapshot(),
    readJson<RuntimeDiagnosticEntry[]>(DIAGNOSTICS_LOGS_KEY),
  ]);

  return {
    boot,
    entries: entries ?? [],
  };
}

export async function clearDiagnostics(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([DIAGNOSTICS_BOOT_KEY, DIAGNOSTICS_LOGS_KEY]);
  } catch {
    // No-op
  }
}

export async function beginBootSession(initialStep: string): Promise<BootSnapshot> {
  const previous = await getBootSnapshot();

  if (previous?.status === 'booting') {
    await appendEntry({
      id: toId('boot_incomplete'),
      at: new Date().toISOString(),
      severity: 'error',
      source: 'boot.previous',
      message: `La sesion previa no finalizo correctamente. Ultimo paso: ${previous.lastStep}`,
      extra: safeExtra({ previousSessionId: previous.sessionId, startedAt: previous.startedAt }),
    });
  }

  const now = new Date().toISOString();
  const snapshot: BootSnapshot = {
    sessionId: toId('boot'),
    startedAt: now,
    updatedAt: now,
    status: 'booting',
    lastStep: initialStep,
  };

  await writeJson(DIAGNOSTICS_BOOT_KEY, snapshot);
  await appendEntry({
    id: toId('boot_start'),
    at: now,
    severity: 'info',
    source: 'boot.start',
    message: initialStep,
    extra: safeExtra({ sessionId: snapshot.sessionId }),
  });
  return snapshot;
}

export async function markBootStep(step: string, extra?: unknown): Promise<void> {
  const current = await getBootSnapshot();
  if (!current) return;

  const updated: BootSnapshot = {
    ...current,
    updatedAt: new Date().toISOString(),
    lastStep: step,
  };

  await writeJson(DIAGNOSTICS_BOOT_KEY, updated);
  await appendEntry({
    id: toId('boot_step'),
    at: updated.updatedAt,
    severity: 'info',
    source: 'boot.step',
    message: step,
    extra: safeExtra(extra),
  });
}

export async function markBootReady(step = 'boot.ready'): Promise<void> {
  const current = await getBootSnapshot();
  if (!current) return;

  const updated: BootSnapshot = {
    ...current,
    updatedAt: new Date().toISOString(),
    status: 'ready',
    lastStep: step,
  };

  await writeJson(DIAGNOSTICS_BOOT_KEY, updated);
  await appendEntry({
    id: toId('boot_ready'),
    at: updated.updatedAt,
    severity: 'info',
    source: 'boot.ready',
    message: step,
  });
}

export async function captureException(
  source: string,
  error: unknown,
  options: CaptureOptions = {},
): Promise<RuntimeDiagnosticEntry> {
  const normalized = normalizeError(error);
  const entry: RuntimeDiagnosticEntry = {
    id: toId('runtime_error'),
    at: new Date().toISOString(),
    severity: 'error',
    source,
    message: normalized.message,
    stack: normalized.stack,
    extra: safeExtra({
      isFatal: Boolean(options.isFatal),
      extra: options.extra,
    }),
  };

  await appendEntry(entry);

  if (options.markBootFailed) {
    const current = await getBootSnapshot();
    if (current) {
      const updated: BootSnapshot = {
        ...current,
        updatedAt: entry.at,
        status: 'failed',
        lastStep: `${source}:failed`,
        lastError: entry,
      };
      await writeJson(DIAGNOSTICS_BOOT_KEY, updated);
    }
  }

  notifyListeners(entry);
  return entry;
}

export function getLatestErrorEntry(report: RuntimeDiagnosticsReport | null): RuntimeDiagnosticEntry | null {
  if (!report) return null;
  return report.entries.find((entry) => entry.severity === 'error') ?? report.boot?.lastError ?? null;
}

export function formatDiagnosticsReport(report: RuntimeDiagnosticsReport): string {
  const latestError = getLatestErrorEntry(report);
  const header = [
    'Diagnostico de la app',
    report.boot ? `Boot status: ${report.boot.status}` : 'Boot status: desconocido',
    report.boot?.sessionId ? `Boot session: ${report.boot.sessionId}` : '',
    report.boot?.lastStep ? `Ultimo paso: ${report.boot.lastStep}` : '',
    latestError?.message ? `Ultimo error: ${latestError.message}` : '',
  ].filter(Boolean);

  const entries = report.entries.slice(0, 12).map((entry) => {
    const lines = [
      `[${entry.at}] ${entry.source}`,
      entry.message,
    ];
    if (entry.extra) lines.push(`extra: ${entry.extra}`);
    if (entry.stack) lines.push(entry.stack);
    return lines.join('\n');
  });

  return [...header, '', ...entries].join('\n');
}
