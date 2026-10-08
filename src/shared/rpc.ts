import type { RPCSchema } from "electrobun/view";

export type Recipient = {
  name: string;
  email: string;
};

export type SendBatchParams = {
  user: string;
  password: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  html: string;
  recipients: Recipient[];
  delayMs: number;
};

export type SendProgress = {
  index: number;
  total: number;
  email: string;
  ok: boolean;
  error?: string;
};

export type SavedState = {
  user: string;
  password: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  html: string;
  delay: number;
  recipients: Recipient[];
};

export type HistoryEntry = SavedState & {
  id: string;
  savedAt: number;
};

export type HistoryMeta = {
  id: string;
  savedAt: number;
  subject: string;
};

export type AppRPC = {
  bun: RPCSchema<{
    requests: {
      verifyCredentials: {
        params: { user: string; password: string };
        response: { ok: boolean; error?: string };
      };
      sendBatch: {
        params: SendBatchParams;
        response: { sent: number; failed: number };
      };
      listHistory: {
        params: {};
        response: { entries: HistoryMeta[] };
      };
      getHistoryEntry: {
        params: { id: string };
        response: { entry: HistoryEntry | null };
      };
      pushHistory: {
        params: { state: SavedState };
        response: { entries: HistoryMeta[] };
      };
      getAppInfo: {
        params: {};
        response: { name: string; version: string; url: string };
      };
      openExternal: {
        params: { url: string };
        response: {};
      };
    };
    messages: {};
  }>;
  webview: RPCSchema<{
    requests: {};
    messages: {
      sendProgress: SendProgress;
    };
  }>;
};
