export type Severity = 'info' | 'warning' | 'error';

export interface TelemetryRecord {
  timestamp: string; // UTC ISO-8601
  eventName: string;
  severity: Severity;
  applicationInstanceId: string;
  directLineInstanceId?: string;
  conversationId?: string;
  messageCorrelationId?: string;
  details: Record<string, unknown>;
}

export interface TokenMetadata {
  receivedAt: string;
  expiresInSeconds: number;
  expectedExpiration: string;
  conversationId: string;
}

export type ConnectionState = 'Not connected' | 'Connecting' | 'Reconnecting' | 'Online' | 'Offline' | 'Error';

export interface AppIdentity {
  currentInstanceId: string;
  previousInstanceId: string | null;
  changed: boolean;
}

export interface MessageResult {
  status: 'started' | 'succeeded' | 'failed';
  correlationId: string;
  activityId?: string;
  elapsedMs: number;
  at: string;
}

export interface ChatMessage {
  id: string;
  from: 'user' | 'bot';
  text: string;
}
