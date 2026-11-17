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
# Optional: seconds in the background after which the connection is recreated on return (default 120)
STALE_AFTER_HIDDEN_SECONDS=120
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

## Phase 2: automatic connection recovery

When the app returns to the foreground (or the network comes back) it checks the connection. The connection is recreated when the status is not Online, when the app was in the background for more than 2 minutes (the socket may be silently dead), or when a recovery was pending because the device was offline.

Recovery: sending is paused and a "Reconnecting" status is shown, the old subscriptions and instance are released, a **new token** is requested, a new Direct Line instance is created (never two at once), and up to 3 attempts are made with backoff. If it cannot be recovered the user is told to press Connect. A recovered session starts a **new conversation** (previous conversation context is not resumed). Events: `CONNECTION_HEALTH_CHECK`, `RECOVERY_STARTED`, `RECOVERY_ATTEMPT`, `RECOVERY_WAITING_FOR_NETWORK`, `RECOVERY_SUCCEEDED`, `RECOVERY_FAILED`.

## Quick test

1. Connect, send a message, confirm the reply.
2. Reload: new application instance ID, navigation type `reload`.
3. Background the app / switch tabs and return: only visibility events, same instance ID.
4. Go offline: `NETWORK_OFFLINE`, then `NETWORK_ONLINE`.
5. Download the logs.

## Testing on an Android phone

Recommended steps (no USB cable needed):

```
npm run build
npx serve dist -l 4000

winget install Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:4000
```

Replace the port if you served on a different one. Open the `https://...trycloudflare.com` URL printed by `cloudflared` in Chrome on the phone, then install the PWA from the browser menu (Add to Home screen / Install app). Run the tests below and use **Download logs** to export the results.

## Android / Zebra test plan

| # | Test | Steps | Expected result |
| --- | --- | --- | --- |
| 1 | Basic chat | Tap Connect. Send "hello". | Status Online. Agent replies. Events: TOKEN_REQUEST_SUCCEEDED, DIRECT_LINE_INSTANCE_CREATED, MESSAGE_SEND_SUCCEEDED, DIRECT_LINE_ACTIVITY_RECEIVED. |
| 2 | Short background | Switch to another app for 30 s, then return. Send a message. | Same application instance ID. Health check reports healthy. Message works. |
| 3 | Long background | Leave the app in the background for 5 min, then return. | Same instance ID. Either healthy, or "Reconnecting" then "Connection restored". Then send a message. |
| 4 | Extended background | Leave the app in the background for 30 min, then return. | Same as test 3, or a new application instance ID (the PWA was reloaded by Android). |
| 5 | Screen lock | Lock the screen for 2 min, then unlock. Send a message. | Same as test 3. |
| 6 | Airplane mode | Turn on airplane mode for 20 s, then turn it off. | NETWORK_OFFLINE, then NETWORK_ONLINE, then recovery. Sending is paused while reconnecting. |
| 7 | Battery saver | Enable battery saver and repeat tests 3 and 5. | Compare results with tests without battery saver. |
| 8 | Swipe-away | Close the PWA from the Recents screen, then reopen it. | New application instance ID. Previous ID shown. Navigation type navigate or reload. The conversation starts fresh (expected in Phase 2). |
| 9 | Send right after returning | Return from background 2 min and send a message immediately. | The message is sent, or blocked while "Reconnecting". It must never fail silently. |

## Limitations

Logs are lost on reload (download first). `navigator.onLine` does not prove Internet access. A suspended browser may leave no events at all.
