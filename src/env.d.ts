declare module '*.css';

declare namespace NodeJS {
  interface ProcessEnv {
    DIRECT_LINE_TOKEN_ENDPOINT?: string;
    STALE_AFTER_HIDDEN_SECONDS?: string;
    NODE_ENV?: string;
  }
}
declare const process: { env: NodeJS.ProcessEnv };
