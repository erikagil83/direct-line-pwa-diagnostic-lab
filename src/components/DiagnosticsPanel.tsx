import { useSyncExternalStore } from 'react';
import { Accordion, AccordionHeader, AccordionItem, AccordionPanel, Badge, Button, Text } from '@fluentui/react-components';
import { TelemetryService } from '../services/TelemetryService';
import { ConnectionState, Severity, TelemetryRecord } from '../types/diagnostics';

interface Props {
  telemetry: TelemetryService;
  state: ConnectionState;
}

const SEVERITY_COLOR: Record<Severity, 'informative' | 'warning' | 'danger'> = {
  info: 'informative',
  warning: 'warning',
  error: 'danger'
};

function summarize(r: TelemetryRecord): string {
  const d = r.details;
  const parts: string[] = [];
  for (const key of ['statusName', 'status', 'visibilityState', 'persisted', 'navigationType', 'activityType', 'activityId',
    'textLength', 'elapsedMs', 'expiresInSeconds', 'changed', 'name', 'message']) {
    if (d[key] !== undefined) parts.push(`${key}=${typeof d[key] === 'object' ? JSON.stringify(d[key]) : d[key]}`);
  }
  const error = d.error as { message?: string } | undefined;
  if (error?.message) parts.push(`error=${error.message}`);
  if (r.messageCorrelationId) parts.push(`corr=${r.messageCorrelationId.slice(0, 8)}`);
  return parts.join(' ');
}

export function DiagnosticsPanel({ telemetry, state }: Props) {
  useSyncExternalStore(telemetry.subscribe, telemetry.getVersion);
  const { context, identity } = telemetry;
  const lastMessage = context.lastMessageResult;
  const records = telemetry.getRecords();

  const rows: [string, string][] = [
    ['App instance ID', identity.currentInstanceId],
    ['Previous instance ID', identity.previousInstanceId ?? '(none)'],
    ['Instance changed', String(identity.changed)],
    ['Navigation type', context.navigationType],
    ['Visibility', context.visibilityState],
    ['Network', context.networkState],
    ['Direct Line status', state],
    ['Direct Line instance ID', context.directLineInstanceId ?? '-'],
    ['Conversation ID', context.conversationId ?? '-'],
    ['Token received', context.tokenMetadata?.receivedAt ?? '-'],
    ['Token expected expiration', context.tokenMetadata?.expectedExpiration ?? '-'],
    ['Last message submission', lastMessage
      ? `${lastMessage.status} (corr ${lastMessage.correlationId.slice(0, 8)}${lastMessage.activityId ? `, activity ${lastMessage.activityId}` : ''}, ${lastMessage.elapsedMs} ms, ${lastMessage.at})` : '-'],
    ['Last activity received', context.lastActivityReceivedAt ?? '-'],
    ['Diagnostic records', String(records.length)]
  ];

  return (
    <Accordion collapsible className="diagnostics">
      <AccordionItem value="diagnostics">
        <AccordionHeader>Diagnostics ({records.length})</AccordionHeader>
        <AccordionPanel>
          <div className="toolbar">
            <Button size="small" onClick={() => telemetry.clear()}>Clear logs</Button>
            <Button size="small" onClick={() => telemetry.download()}>Download logs</Button>
          </div>
          <dl className="facts">
            {rows.map(([k, v]) => (
              <div key={k} className="fact"><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
          <Text weight="semibold">Events</Text>
          <ol className="events">
            {records.map((r, i) => (
              <li key={`${r.timestamp}-${i}`}>
                <span className="ts">{r.timestamp}</span>{' '}
                <Badge size="small" color={SEVERITY_COLOR[r.severity]}>{r.severity}</Badge>{' '}
                <strong>{r.eventName}</strong>
                <div className="summary">{summarize(r)}</div>
              </li>
            ))}
          </ol>
        </AccordionPanel>
      </AccordionItem>
    </Accordion>
  );
}
