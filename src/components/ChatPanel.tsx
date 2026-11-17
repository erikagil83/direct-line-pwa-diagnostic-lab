import { useState } from 'react';
import { Badge, Button, Input, MessageBar, MessageBarBody, Text } from '@fluentui/react-components';
import { ChatMessage, ConnectionState } from '../types/diagnostics';

interface Props {
  state: ConnectionState;
  notice: string | null;
  messages: ChatMessage[];
  onConnect: () => void;
  onDisconnect: () => void;
  onSend: (text: string) => void;
}

const COLORS: Record<ConnectionState, 'subtle' | 'warning' | 'success' | 'danger' | 'informative'> = {
  'Not connected': 'subtle',
  Connecting: 'warning',
  Reconnecting: 'warning',
  Online: 'success',
  Offline: 'informative',
  Error: 'danger'
};

export function ChatPanel({ state, notice, messages, onConnect, onDisconnect, onSend }: Props) {
  const [text, setText] = useState('');
  const canSend = state === 'Online' && text.trim().length > 0;
  const active = state !== 'Not connected' && state !== 'Error';

  const submit = () => {
    if (!canSend) return;
    onSend(text.trim());
    setText('');
  };

  return (
    <section className="chat-panel">
      <div className="toolbar">
        <Badge appearance="filled" color={COLORS[state]} size="large">{state}</Badge>
        <Button appearance="primary" onClick={onConnect} disabled={active}>Connect</Button>
        <Button onClick={onDisconnect} disabled={state === 'Not connected'}>Disconnect</Button>
      </div>

      {state === 'Reconnecting' && (
        <MessageBar intent="warning"><MessageBarBody>Reconnecting… sending is paused.</MessageBarBody></MessageBar>
      )}
      {notice && state !== 'Reconnecting' && (
        <MessageBar intent={state === 'Error' ? 'error' : 'info'}><MessageBarBody>{notice}</MessageBarBody></MessageBar>
      )}

      <div className="messages" role="log" aria-live="polite">
        {messages.length === 0 && <Text italic>No messages yet.</Text>}
        {messages.map(m => (
          <div key={m.id} className={`bubble ${m.from}`}>{m.text}</div>
        ))}
      </div>

      <form className="composer" onSubmit={e => { e.preventDefault(); submit(); }}>
        <Input
          className="composer-input"
          value={text}
          onChange={(_, d) => setText(d.value)}
          placeholder="Type a message"
        />
        <Button appearance="primary" type="submit" disabled={!canSend}>Send</Button>
      </form>
    </section>
  );
}
