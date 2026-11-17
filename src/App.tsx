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
  const [notice, setNotice] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const serviceRef = useRef<DirectLineService | null>(null);

  if (!serviceRef.current) {
    serviceRef.current = new DirectLineService(telemetry, process.env.DIRECT_LINE_TOKEN_ENDPOINT as string, {
      onState: setState,
      onNotice: setNotice,
      onMessageResult: result => telemetry.setContext({ lastMessageResult: result }),
      onActivity: (activity, receivedAt) => {
        telemetry.setContext({ lastActivityReceivedAt: receivedAt });
        const a = activity as { id?: string; type: string; text?: string; from?: { id?: string; role?: string } };
        // Direct Line echoes the user's own messages back; only show bot messages.
        if (a.type === 'message' && a.text && a.from?.role !== 'user' && a.from?.id !== 'user') {
          const id = a.id ?? crypto.randomUUID();
          setMessages(m => (m.some(x => x.id === id) ? m : [...m, { id, from: 'bot', text: a.text as string }]));
        }
      }
    });
  }
  const service = serviceRef.current;

  useEffect(() => {
    const stopLifecycle = startLifecycleDiagnostics(telemetry);
    const stopErrors = startGlobalErrorDiagnostics(telemetry);
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      const hiddenMs = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      service.evaluate('foreground', hiddenMs);
    };
    const onOnline = () => {
      setOffline(false);
      service.evaluate('network_online');
    };
    const onOffline = () => setOffline(true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      stopLifecycle();
      stopErrors();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      service.disconnect();
    };
  }, [service]);

  const displayState: ConnectionState =
    offline && (state === 'Online' || state === 'Connecting' || state === 'Reconnecting') ? 'Offline' : state;

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
          notice={notice}
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
