import { useEffect, useRef, useState } from 'react';
import { FluentProvider, Title3, webLightTheme } from '@fluentui/react-components';
import { ChatPanel } from './components/ChatPanel';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { DirectLineService } from './services/DirectLineService';
import { TelemetryService } from './services/TelemetryService';
import { startLifecycleDiagnostics } from './diagnostics/LifecycleDiagnostics';
import { startGlobalErrorDiagnostics } from './diagnostics/GlobalErrorDiagnostics';
import { AppIdentity, ChatMessage, ConnectionState } from './types/diagnostics';

const STORAGE_KEY = 'dl-lab-last-app-instance-id';

function createIdentity(): AppIdentity {
  const currentInstanceId = crypto.randomUUID();
  const previousInstanceId = localStorage.getItem(STORAGE_KEY);
  localStorage.setItem(STORAGE_KEY, currentInstanceId); // stored only for comparison on the next start
  return { currentInstanceId, previousInstanceId, changed: previousInstanceId !== currentInstanceId };
}

// Created once per JavaScript application start.
const telemetry = new TelemetryService(createIdentity());

export function App() {
  const [state, setState] = useState<ConnectionState>('Not connected');
  const [offline, setOffline] = useState(!navigator.onLine);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const serviceRef = useRef<DirectLineService | null>(null);

  if (!serviceRef.current) {
    serviceRef.current = new DirectLineService(telemetry, process.env.DIRECT_LINE_TOKEN_ENDPOINT as string, {
      onState: setState,
      onMessageResult: result => telemetry.setContext({ lastMessageResult: result }),
      onActivity: (activity, receivedAt) => {
        telemetry.setContext({ lastActivityReceivedAt: receivedAt });
        const a = activity as { id?: string; type: string; text?: string; from?: { id?: string; role?: string } };
        // Direct Line echoes the user's own messages back; only show bot messages.
        if (a.type === 'message' && a.text && a.from?.role !== 'user' && a.from?.id !== 'user') {
          setMessages(m => [...m, { id: a.id ?? crypto.randomUUID(), from: 'bot', text: a.text as string }]);
        }
      }
    });
  }
  const service = serviceRef.current;

  useEffect(() => {
    const stopLifecycle = startLifecycleDiagnostics(telemetry);
    const stopErrors = startGlobalErrorDiagnostics(telemetry);
    const sync = () => setOffline(!navigator.onLine);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      stopLifecycle();
      stopErrors();
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
      service.disconnect();
    };
  }, [service]);

  const displayState: ConnectionState = offline && (state === 'Online' || state === 'Connecting') ? 'Offline' : state;

  const send = (text: string) => {
    setMessages(m => [...m, { id: crypto.randomUUID(), from: 'user', text }]);
    service.send(text);
  };

  return (
    <FluentProvider theme={webLightTheme}>
      <div className="app">
        <header><Title3 as="h1">Direct Line PWA Diagnostic Lab</Title3></header>
        <ChatPanel
          state={displayState}
          messages={messages}
          onConnect={() => void service.connect()}
          onDisconnect={() => service.disconnect()}
          onSend={send}
        />
        <DiagnosticsPanel telemetry={telemetry} state={displayState} />
      </div>
    </FluentProvider>
  );
}
