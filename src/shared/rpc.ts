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
  text: string;
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
