import { AppIdentity, MessageResult, Severity, TelemetryRecord, TokenMetadata } from '../types/diagnostics';

const MAX_RECORDS = 500;
const SENSITIVE_KEY = /token|authorization|cookie|secret|password|headers|payload|^text$/i;
const BEARER = /bearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;
const MAX_STRING = 2000;

export function sanitizeString(value: string): string {
  const cleaned = value.replace(BEARER, 'Bearer [redacted]').replace(JWT, '[redacted]');
  return cleaned.length > MAX_STRING ? cleaned.slice(0, MAX_STRING) + '…' : cleaned;
}

export function sanitize(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return sanitizeString(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth > 3) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 20).map(v => sanitize(v, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    result[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : sanitize(v, depth + 1);
  }
  return result;
}

export interface TelemetryContext {
  directLineInstanceId?: string;
  conversationId?: string;
  navigationType: string;
  networkState: string;
  visibilityState: string;
  tokenMetadata?: TokenMetadata;
  lastMessageResult?: MessageResult;
  lastActivityReceivedAt?: string;
}

type Listener = () => void;

export class TelemetryService {
  private records: TelemetryRecord[] = [];
  private listeners = new Set<Listener>();
  private version = 0;
  readonly context: TelemetryContext = {
    navigationType: 'unknown',
    networkState: 'unknown',
    visibilityState: 'unknown'
  };

  constructor(readonly identity: AppIdentity) {}

  setContext(patch: Partial<TelemetryContext>): void {
    Object.assign(this.context, patch);
    this.notify();
  }

  add(
    eventName: string,
    severity: Severity = 'info',
    details: Record<string, unknown> = {},
    correlationId?: string,
    overrides: { directLineInstanceId?: string; conversationId?: string } = {}
  ): void {
    if (this.records.length >= MAX_RECORDS) this.records.shift();
    this.records.push({
      timestamp: new Date().toISOString(),
      eventName,
      severity,
      applicationInstanceId: this.identity.currentInstanceId,
      directLineInstanceId: overrides.directLineInstanceId ?? this.context.directLineInstanceId,
      conversationId: overrides.conversationId ?? this.context.conversationId,
      messageCorrelationId: correlationId,
      details: sanitize(details) as Record<string, unknown>
    });
    this.notify();
  }

  getRecords(): readonly TelemetryRecord[] {
    return this.records;
  }

  clear(): void {
    this.records = [];
    this.notify();
  }

  // useSyncExternalStore-compatible API
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  buildExport() {
    return {
      summary: {
        exportedAt: new Date().toISOString(),
        recordCount: this.records.length,
        currentApplicationInstanceId: this.identity.currentInstanceId,
        previousApplicationInstanceId: this.identity.previousInstanceId,
        applicationInstanceChanged: this.identity.changed,
        directLineInstanceId: this.context.directLineInstanceId ?? null,
        conversationId: this.context.conversationId ?? null,
        navigationType: this.context.navigationType,
        networkState: this.context.networkState,
        visibilityState: this.context.visibilityState,
        tokenMetadata: this.context.tokenMetadata ?? null,
        lastMessageResult: this.context.lastMessageResult ?? null,
        lastActivityReceivedAt: this.context.lastActivityReceivedAt ?? null
      },
      records: this.records
    };
  }

  download(): void {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp =
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-` +
      `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const blob = new Blob([JSON.stringify(this.buildExport(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `direct-line-diagnostics-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private notify(): void {
    this.version++;
    this.listeners.forEach(l => l());
  }
}
