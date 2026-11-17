declare module '*.css';

declare namespace NodeJS {
  interface ProcessEnv {
    DIRECT_LINE_TOKEN_ENDPOINT?: string;
    NODE_ENV?: string;
  }
}
declare const process: { env: NodeJS.ProcessEnv };
