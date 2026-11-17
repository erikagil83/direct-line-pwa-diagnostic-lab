import { TelemetryService } from '../services/TelemetryService';

// Never serialize objects: they may carry credentials or request data. Primitives only.
function safeReason(reason: unknown): string {
  if (reason === null || reason === undefined) return String(reason);
  if (typeof reason === 'string') return reason;
  if (typeof reason === 'number' || typeof reason === 'boolean' || typeof reason === 'bigint') return String(reason);
  return `[non-error ${typeof reason}]`;
}

export function startGlobalErrorDiagnostics(telemetry: TelemetryService): () => void {
  const onError = (e: ErrorEvent) => {
    telemetry.add('GLOBAL_JAVASCRIPT_ERROR', 'error', {
      name: e.error instanceof Error ? e.error.name : 'Error',
      message: e.message,
      fileName: e.filename || undefined,
      lineNumber: e.lineno || undefined,
      columnNumber: e.colno || undefined,
      stack: e.error instanceof Error ? e.error.stack : undefined
    });
  };

  const onRejection = (e: PromiseRejectionEvent) => {
    const reason: unknown = e.reason;
    telemetry.add(
      'UNHANDLED_PROMISE_REJECTION',
      'error',
      reason instanceof Error
        ? { name: reason.name, message: reason.message, stack: reason.stack }
        : { name: 'NonErrorRejection', message: safeReason(reason) }
    );
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
