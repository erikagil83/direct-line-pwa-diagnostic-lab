# Direct Line PWA Diagnostic Lab (Phase 1)

React 18 + TypeScript + Fluent UI PWA that connects to a Microsoft Copilot Studio agent through Direct Line and collects **diagnostics and telemetry only**. It is meant to gather evidence about why a PWA may stop receiving agent responses after being backgrounded (for example on Android Zebra devices). It does **not** fix the problem: there is no automatic reconnection or session recovery.

## Run it

```
npm install
copy .env.example .env      # then edit .env
npm start                   # http://localhost:3000
```

`.env`:

```
DIRECT_LINE_TOKEN_ENDPOINT=<your Copilot Studio token endpoint>
```

Find it in Copilot Studio: Channels > Mobile app (or Web channel) > Token endpoint. It must return `{ token, conversationId, expires_in }`. Restart `npm start` after editing `.env`. Never put a Direct Line secret in this file. The agent must be published.

Other commands: `npm run typecheck`, `npm run build` (output in `dist/`; serve it with `npx serve dist`). The service worker is registered only in production builds. PWA install requires HTTPS or localhost.

## What it records

Events are kept in memory (max 500) and shown in the Diagnostics panel; **Download logs** saves `direct-line-diagnostics-YYYY-MM-DD-HHmmss.json`.

- Lifecycle: `APPLICATION_STARTED`, `APPLICATION_INSTANCE_CREATED`, `NAVIGATION_TYPE_DETECTED`, `VISIBILITY_CHANGED`, `PAGE_SHOWN`, `PAGE_HIDDEN`, `NETWORK_ONLINE`, `NETWORK_OFFLINE`
- Token: `TOKEN_REQUEST_STARTED/SUCCEEDED/FAILED` (issue and expected expiry time, never the token)
- Direct Line: `DIRECT_LINE_INSTANCE_CREATED`, `DIRECT_LINE_STATUS_CHANGED`, `DIRECT_LINE_ACTIVITY_RECEIVED`, `DIRECT_LINE_ACTIVITY_STREAM_ERROR`, `DIRECT_LINE_DISCONNECTED`
- Messages: `MESSAGE_SEND_STARTED/SUCCEEDED/FAILED` (correlation ID, elapsed time, activity ID, text length only)
- Errors: `GLOBAL_JAVASCRIPT_ERROR`, `UNHANDLED_PROMISE_REJECTION`

Tokens, authorization data and message text are never logged, stored or downloaded.

## Quick test

1. Connect, send a message, confirm the reply.
2. Reload: new application instance ID, navigation type `reload`.
3. Background the app / switch tabs and return: only visibility events, same instance ID.
4. Go offline: `NETWORK_OFFLINE`, then `NETWORK_ONLINE`.
5. Download the logs.

## Limitations

Logs are lost on reload (download first). `navigator.onLine` does not prove Internet access. A suspended browser may leave no events at all.
