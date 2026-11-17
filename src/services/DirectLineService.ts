import { Activity, ConnectionStatus, DirectLine } from 'botframework-directlinejs';
import { TelemetryService } from './TelemetryService';
import { ConnectionState, MessageResult, TokenMetadata } from '../types/diagnostics';

const STATUS_NAMES: Record<number, string> = {
  [ConnectionStatus.Uninitialized]: 'Uninitialized',
  [ConnectionStatus.Connecting]: 'Connecting',
  [ConnectionStatus.Online]: 'Online',
  [ConnectionStatus.ExpiredToken]: 'ExpiredToken',
  [ConnectionStatus.FailedToConnect]: 'FailedToConnect',
  [ConnectionStatus.Ended]: 'Ended'
};

export interface DirectLineHandlers {
  onState: (state: ConnectionState) => void;
  onNotice: (text: string | null) => void;
  onActivity: (activity: Activity, receivedAt: string) => void;
  onMessageResult: (result: MessageResult) => void;
}

interface TokenResponse {
  token: string;
  conversationId: string;
  expires_in: number;
}

function errorInfo(err: unknown): Record<string, unknown> {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { name: typeof err, message: String(err) };
}

// botframework-directlinejs bundles its own RxJS; only unsubscribe() is needed here.
interface Unsubscribable {
  unsubscribe(): void;
}

const MAX_RECOVERY_ATTEMPTS = 3;
const RECOVERY_BACKOFF_MS = 2000; // multiplied by the attempt number
const ONLINE_TIMEOUT_MS = 20000;
// After this long in the background the socket may be silently dead even if the status still says Online.
// Configurable with STALE_AFTER_HIDDEN_SECONDS in .env (default 120).
const configuredSeconds = Number(process.env.STALE_AFTER_HIDDEN_SECONDS);
const STALE_AFTER_HIDDEN_MS = (Number.isFinite(configuredSeconds) && configuredSeconds > 0 ? configuredSeconds : 120) * 1000;

export class DirectLineService {
  private directLine: DirectLine | null = null;
  private subscriptions: Unsubscribable[] = [];
  private instanceId: string | undefined;
  private conversationId: string | undefined;
  private connecting = false;
  private failed = false;
  private generation = 0;
  private lastStatus: ConnectionStatus = ConnectionStatus.Uninitialized;
  private wanted = false; // a session was established and the user has not disconnected
  private recovering = false;
  private needsRecovery = false;
  private waiter: ((online: boolean) => void) | null = null;

  constructor(
    private readonly telemetry: TelemetryService,
    private readonly endpoint: string,
    private readonly handlers: DirectLineHandlers
  ) {}

  get isActive(): boolean {
    return this.connecting || this.recovering || this.directLine !== null;
  }

  async connect(): Promise<void> {
    if (this.failed) {
      // Failed instance: release it before creating a new one (manual Connect only).
      this.teardown();
      this.failed = false;
      this.telemetry.add('DIRECT_LINE_DISCONNECTED', 'info', { reason: 'replaced_after_failure' });
    }
    if (this.isActive) return; // prevents duplicate instances and subscriptions
    this.connecting = true;
    this.needsRecovery = false;
    const generation = ++this.generation;
    this.handlers.onNotice(null);
    this.handlers.onState('Connecting');

    const opened = await this.open(generation);
    if (generation !== this.generation) return; // disconnected meanwhile
    this.connecting = false;
    if (!opened) this.handlers.onState('Error');
  }

  // Called when the app returns to the foreground or the network comes back.
  evaluate(trigger: string, hiddenMs = 0): void {
    if (!this.wanted || this.recovering || this.connecting) return;
    const reasons: string[] = [];
    if (this.needsRecovery) reasons.push('pending_recovery');
    if (this.lastStatus !== ConnectionStatus.Online) reasons.push(`status_${STATUS_NAMES[this.lastStatus]}`);
    if (hiddenMs > STALE_AFTER_HIDDEN_MS) reasons.push('background_stale');
    this.telemetry.add('CONNECTION_HEALTH_CHECK', reasons.length ? 'warning' : 'info', {
      trigger,
      healthy: reasons.length === 0,
      reasons,
      hiddenMs: Math.round(hiddenMs),
      statusName: STATUS_NAMES[this.lastStatus],
      directLineInstanceId: this.instanceId
    });
    if (reasons.length) void this.recover(reasons[0]);
  }

  disconnect(): void {
    if (!this.isActive) return;
    this.generation++; // invalidates any in-flight token request or recovery
    this.connecting = false;
    this.recovering = false;
    this.wanted = false;
    this.needsRecovery = false;
    this.waiter?.(false);
    this.teardown();
    this.telemetry.add('DIRECT_LINE_DISCONNECTED', 'info', { reason: 'user_or_unmount' });
    this.handlers.onNotice(null);
    this.handlers.onState('Not connected');
  }

  // Requests a fresh credential and creates the Direct Line instance. Returns false on failure.
  private async open(generation: number): Promise<boolean> {
    let tokenData: TokenResponse;
    try {
      tokenData = await this.requestToken();
    } catch {
      return false;
    }
    if (generation !== this.generation) return false;

    const domain = await this.resolveDomain();
    if (generation !== this.generation) return false;

    this.conversationId = tokenData.conversationId;
    this.instanceId = crypto.randomUUID();
    this.telemetry.setContext({ directLineInstanceId: this.instanceId, conversationId: this.conversationId });

    // The token endpoint's conversationId is not a started Direct Line conversation (GET returns 404),
    // so let Direct Line create the conversation and read its ID once online.
    this.directLine = new DirectLine({ token: tokenData.token, domain });
    this.telemetry.add('DIRECT_LINE_INSTANCE_CREATED', 'info', { domainHost: domain ? new URL(domain).host : 'default' });

    this.subscriptions.push(
      this.directLine.connectionStatus$.subscribe({
        next: status => this.onStatus(status),
        error: err => this.onStreamError('connectionStatus$', err)
      }),
      this.directLine.activity$.subscribe({
        next: activity => this.onActivity(activity),
        error: err => this.onStreamError('activity$', err)
      })
    );
    return true;
  }

  private async recover(trigger: string): Promise<void> {
    if (!this.wanted || this.recovering || this.connecting) return;
    if (!navigator.onLine) {
      this.needsRecovery = true; // retried by evaluate() when the network returns
      this.telemetry.add('RECOVERY_WAITING_FOR_NETWORK', 'warning', { trigger });
      return;
    }

    this.recovering = true;
    this.needsRecovery = false;
    const generation = ++this.generation;
    this.handlers.onNotice(null);
    this.handlers.onState('Reconnecting');
    this.telemetry.add('RECOVERY_STARTED', 'warning', { trigger, previousDirectLineInstanceId: this.instanceId });
    this.teardown(); // old subscriptions are cancelled before a new instance exists
    this.telemetry.add('DIRECT_LINE_DISCONNECTED', 'info', { reason: 'recovery' });

    for (let attempt = 1; attempt <= MAX_RECOVERY_ATTEMPTS; attempt++) {
      if (!navigator.onLine) {
        this.recovering = false;
        this.needsRecovery = true;
        this.telemetry.add('RECOVERY_WAITING_FOR_NETWORK', 'warning', { trigger, attempt });
        return;
      }
      this.telemetry.add('RECOVERY_ATTEMPT', 'info', { attempt, maxAttempts: MAX_RECOVERY_ATTEMPTS });
      const ok = (await this.open(generation)) && (await this.waitOnline());
      if (generation !== this.generation) return; // disconnect() took over
      if (ok) {
        this.recovering = false;
        this.telemetry.add('RECOVERY_SUCCEEDED', 'info', { attempt, directLineInstanceId: this.instanceId });
        this.handlers.onNotice('Connection restored. A new conversation was started.');
        return;
      }
      this.teardown();
      if (attempt < MAX_RECOVERY_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, RECOVERY_BACKOFF_MS * attempt));
        if (generation !== this.generation) return;
      }
    }

    this.recovering = false;
    this.wanted = false; // the user must press Connect; no endless background retries
    this.telemetry.add('RECOVERY_FAILED', 'error', { attempts: MAX_RECOVERY_ATTEMPTS, trigger });
    this.handlers.onNotice('The session could not be recovered. Press Connect to start a new one.');
    this.handlers.onState('Error');
  }

  private waitOnline(): Promise<boolean> {
    if (this.lastStatus === ConnectionStatus.Online) return Promise.resolve(true);
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.waiter = null; resolve(false); }, ONLINE_TIMEOUT_MS);
      this.waiter = online => { clearTimeout(timer); this.waiter = null; resolve(online); };
    });
  }

  send(text: string): void {
    const correlationId = crypto.randomUUID();
    const conversationId = this.conversationId;
    const startedAt = performance.now();
    const elapsed = () => Math.round(performance.now() - startedAt);
    const record = (status: MessageResult['status'], activityId?: string) =>
      this.handlers.onMessageResult({ status, correlationId, activityId, elapsedMs: elapsed(), at: new Date().toISOString() });
    const instanceId = this.instanceId;

    this.telemetry.add('MESSAGE_SEND_STARTED', 'info',
      { textLength: text.length, directLineInstanceId: instanceId, conversationId }, correlationId);
    record('started');

    if (!this.directLine || this.recovering) {
      const reason = this.recovering
        ? { name: 'Reconnecting', message: 'Sending is paused while the connection is being recovered' }
        : { name: 'NotConnected', message: 'Direct Line connection is not available' };
      this.telemetry.add('MESSAGE_SEND_FAILED', 'error',
        { error: reason, elapsedMs: elapsed(), directLineInstanceId: instanceId, conversationId }, correlationId);
      record('failed');
      return;
    }

    const sub = this.directLine
      .postActivity({ from: { id: 'user', name: 'User' }, type: 'message', text })
      .subscribe({
        next: activityId => {
          this.telemetry.add('MESSAGE_SEND_SUCCEEDED', 'info',
            { activityId, elapsedMs: elapsed(), directLineInstanceId: instanceId, conversationId }, correlationId);
          record('succeeded', activityId);
        },
        error: err => {
          this.telemetry.add('MESSAGE_SEND_FAILED', 'error',
            { error: errorInfo(err), elapsedMs: elapsed(), directLineInstanceId: instanceId, conversationId }, correlationId);
          record('failed');
        }
      });
    this.subscriptions.push(sub);
  }

  // Copilot Studio agents use a regional Direct Line domain published next to the token endpoint.
  private async resolveDomain(): Promise<string | undefined> {
    try {
      const origin = new URL(this.endpoint).origin;
      const response = await fetch(`${origin}/powervirtualagents/regionalchannelsettings?api-version=2022-03-01-preview`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const url: unknown = (await response.json())?.channelUrlsById?.directline;
      if (typeof url !== 'string' || !url) throw new Error('No directline URL in regional settings');
      return `${url.replace(/\/+$/, '')}/v3/directline`;
    } catch (err) {
      this.telemetry.add('REGIONAL_SETTINGS_FAILED', 'warning', { error: errorInfo(err) });
      return undefined;
    }
  }

  private async requestToken(): Promise<TokenResponse> {
    this.telemetry.add('TOKEN_REQUEST_STARTED', 'info');
    const startedAt = performance.now();
    const elapsed = () => Math.round(performance.now() - startedAt);
    let httpStatus: number | undefined;
    try {
      if (!this.endpoint) throw new Error('DIRECT_LINE_TOKEN_ENDPOINT is not configured');
      const response = await fetch(this.endpoint, { cache: 'no-store' });
      httpStatus = response.status;
      if (!response.ok) throw new Error(`Token endpoint returned HTTP ${response.status}`);
      const data = await response.json();
      if (
        !data ||
        typeof data.token !== 'string' || !data.token ||
        typeof data.conversationId !== 'string' || !data.conversationId ||
        typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 0
      ) {
        throw new Error('Token endpoint response is missing token, conversationId or expires_in');
      }

      const received = new Date();
      const metadata: TokenMetadata = {
        receivedAt: received.toISOString(),
        expiresInSeconds: data.expires_in,
        expectedExpiration: new Date(received.getTime() + data.expires_in * 1000).toISOString(),
        conversationId: data.conversationId
      };
      this.telemetry.setContext({ tokenMetadata: metadata });
      this.telemetry.add('TOKEN_REQUEST_SUCCEEDED', 'info', { ...metadata, httpStatus, elapsedMs: elapsed() }, undefined, { conversationId: data.conversationId });
      return { token: data.token, conversationId: data.conversationId, expires_in: data.expires_in };
    } catch (err) {
      this.telemetry.add('TOKEN_REQUEST_FAILED', 'error', { error: errorInfo(err), httpStatus, elapsedMs: elapsed() });
      throw err;
    }
  }

  private onStatus(status: ConnectionStatus): void {
    this.lastStatus = status;
    const liveId = (this.directLine as unknown as { conversationId?: string } | null)?.conversationId;
    if (liveId && liveId !== this.conversationId) {
      this.conversationId = liveId;
      this.telemetry.setContext({ conversationId: liveId });
    }
    this.telemetry.add('DIRECT_LINE_STATUS_CHANGED', status === ConnectionStatus.Online ? 'info' : 'warning', {
      status,
      statusName: STATUS_NAMES[status] ?? 'Unknown',
      directLineInstanceId: this.instanceId,
      conversationId: this.conversationId
    });
    switch (status) {
      case ConnectionStatus.Online:
        this.wanted = true;
        this.handlers.onState('Online');
        this.waiter?.(true);
        break;
      case ConnectionStatus.ExpiredToken:
      case ConnectionStatus.FailedToConnect:
      case ConnectionStatus.Ended:
        this.waiter?.(false);
        if (this.recovering) break; // the recovery loop decides what happens next
        this.failed = true;
        this.handlers.onState('Error');
        if (this.wanted) {
          this.needsRecovery = true;
          if (document.visibilityState === 'visible') void this.recover(`status_${STATUS_NAMES[status]}`);
        }
        break;
      default:
        this.handlers.onState(this.recovering ? 'Reconnecting' : 'Connecting');
    }
  }

  private onActivity(activity: Activity): void {
    const receivedAt = new Date().toISOString();
    const a = activity as Activity & { name?: string; text?: string; timestamp?: string; conversation?: { id?: string } };
    this.telemetry.add('DIRECT_LINE_ACTIVITY_RECEIVED', 'info', {
      activityId: a.id,
      activityType: a.type,
      activityName: a.name,
      senderId: a.from?.id,
      conversationId: a.conversation?.id ?? this.conversationId,
      activityTimestamp: a.timestamp,
      textLength: typeof a.text === 'string' ? a.text.length : undefined
    });
    this.handlers.onActivity(activity, receivedAt);
  }

  private onStreamError(stream: string, err: unknown): void {
    this.telemetry.add('DIRECT_LINE_ACTIVITY_STREAM_ERROR', 'error', { stream, error: errorInfo(err) });
    this.waiter?.(false);
    if (this.recovering) return;
    this.failed = true;
    this.handlers.onState('Error');
    if (this.wanted) {
      this.needsRecovery = true;
      if (document.visibilityState === 'visible') void this.recover('stream_error');
    }
  }

  private teardown(): void {
    this.failed = false;
    this.lastStatus = ConnectionStatus.Uninitialized;
    this.subscriptions.forEach(s => s.unsubscribe());
    this.subscriptions = [];
    this.directLine?.end();
    this.directLine = null;
  }
}
