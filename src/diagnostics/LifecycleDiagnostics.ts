import { TelemetryService } from '../services/TelemetryService';

type NavigationType = 'navigate' | 'reload' | 'back_forward' | 'prerender' | 'unknown';

function detectNavigationType(): NavigationType {
  const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const type = entry?.type;
  return type === 'navigate' || type === 'reload' || type === 'back_forward' || type === 'prerender'
    ? type
    : 'unknown';
}

const networkState = () => (navigator.onLine ? 'online' : 'offline');

let startupLogged = false;

export function startLifecycleDiagnostics(telemetry: TelemetryService): () => void {
  const { identity } = telemetry;
  const navigationType = detectNavigationType();

  telemetry.setContext({
    navigationType,
    networkState: networkState(),
    visibilityState: document.visibilityState
  });

  // Startup events are logged once per JavaScript start, even if React re-runs the effect (Strict Mode).
  if (!startupLogged) {
    startupLogged = true;
    telemetry.add('APPLICATION_STARTED', 'info', { visibilityState: document.visibilityState });
    telemetry.add('APPLICATION_INSTANCE_CREATED', 'info', {
      currentApplicationInstanceId: identity.currentInstanceId,
      previousApplicationInstanceId: identity.previousInstanceId,
      changed: identity.changed
    });
    telemetry.add('NAVIGATION_TYPE_DETECTED', 'info', { navigationType });
  }
  const onVisibility = () => {
    telemetry.setContext({ visibilityState: document.visibilityState });
    telemetry.add('VISIBILITY_CHANGED', 'info', { visibilityState: document.visibilityState });
  };
  const onPageShow = (e: PageTransitionEvent) => telemetry.add('PAGE_SHOWN', 'info', { persisted: e.persisted });
  const onPageHide = (e: PageTransitionEvent) => telemetry.add('PAGE_HIDDEN', 'info', { persisted: e.persisted });
  const onOnline = () => {
    telemetry.setContext({ networkState: 'online' });
    telemetry.add('NETWORK_ONLINE', 'info');
  };
  const onOffline = () => {
    telemetry.setContext({ networkState: 'offline' });
    telemetry.add('NETWORK_OFFLINE', 'warning');
  };

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}
