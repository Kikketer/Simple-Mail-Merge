import {
  app,
  BrowserView,
  BrowserWindow,
  ApplicationMenu,
} from "electrobun/main";
import nodemailer from "nodemailer";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type {
  AppRPC,
  HistoryEntry,
  HistoryMeta,
  SavedState,
  SendBatchParams,
} from "../shared/rpc";

const HISTORY_LIMIT = 50;

function historyFilePath() {
  const base =
    process.platform === "darwin"
      ? join(homedir(), "Library", "Application Support")
      : process.platform === "win32"
        ? (process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"))
        : (process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"));
  return join(base, "com.cjweed.simplemailmerge", "history.json");
}

function readHistory(): HistoryEntry[] {
  try {
    const file = historyFilePath();
    if (!existsSync(file)) return [];
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function writeHistory(entries: HistoryEntry[]) {
  const file = historyFilePath();
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(entries));
}

const toMeta = (e: HistoryEntry): HistoryMeta => ({
  id: e.id,
  savedAt: e.savedAt,
  subject: e.subject,
});

function createTransporter(user: string, password: string) {
  return nodemailer.createTransport({
    host: "smtp.mail.me.com",
    port: 587,
    secure: false,
    auth: { user, pass: password },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const rpc = BrowserView.defineRPC<AppRPC>({
  handlers: {
    requests: {
      verifyCredentials: async ({ user, password }) => {
        try {
          await createTransporter(user, password).verify();
          return { ok: true };
        } catch (err) {
          return { ok: false, error: String(err) };
        }
      },
      sendBatch: async (params: SendBatchParams) => {
        const transporter = createTransporter(params.user, params.password);
        let sent = 0;
        let failed = 0;

        for (let i = 0; i < params.recipients.length; i++) {
          const r = params.recipients[i];
          try {
            await transporter.sendMail({
              from: `"${params.fromName || params.fromEmail || params.user}" <${params.fromEmail || params.user}>`,
              to: `"${r.name}" <${r.email}>`,
              subject: params.subject,
              html: params.html,
              text: params.text,
            });
            sent++;
            rpc.send.sendProgress({
              index: i,
              total: params.recipients.length,
              email: r.email,
              ok: true,
            });
          } catch (err) {
            failed++;
            rpc.send.sendProgress({
              index: i,
              total: params.recipients.length,
              email: r.email,
              ok: false,
              error: String(err),
            });
          }
          if (i < params.recipients.length - 1 && params.delayMs > 0) {
            await sleep(params.delayMs);
          }
        }
        return { sent, failed };
      },
      listHistory: async () => ({
        entries: readHistory().map(toMeta),
      }),
      getHistoryEntry: async ({ id }) => ({
        entry: readHistory().find((e) => e.id === id) ?? null,
      }),
      pushHistory: async ({ state }: { state: SavedState }) => {
        const entries = readHistory();
        const newest = entries[0];
        const { id: _id, savedAt: _savedAt, ...rest } = newest ?? {};
        const changed =
          !newest || JSON.stringify(rest) !== JSON.stringify(state);
        if (changed) {
          entries.unshift({
            ...state,
            id: crypto.randomUUID(),
            savedAt: Date.now(),
          });
          if (entries.length > HISTORY_LIMIT) {
            entries.length = HISTORY_LIMIT;
          }
          writeHistory(entries);
        }
        return { entries: entries.map(toMeta) };
      },
    },
    messages: {},
  },
});

new BrowserWindow({
  title: "Simple Mail Merge",
  url: "views://mainview/index.html",
  frame: { width: 1000, height: 750 },
  rpc,
});

ApplicationMenu.setApplicationMenu([
  {
    label: "Simple Mail Merge",
    submenu: [
      {
        label: "Quit Simple Mail Merge",
        action: "quit",
        accelerator: "CommandOrControl+Q",
      },
    ],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo", accelerator: "CommandOrControl+Z" },
      { role: "redo", accelerator: "CommandOrControl+Shift+Z" },
      { type: "divider" },
      { role: "cut", accelerator: "CommandOrControl+X" },
      { role: "copy", accelerator: "CommandOrControl+C" },
      { role: "paste", accelerator: "CommandOrControl+V" },
      { role: "selectAll", accelerator: "CommandOrControl+A" },
    ],
  },
]);

ApplicationMenu.on("application-menu-clicked", (e) => {
  const action = (e as { data?: { action?: string } }).data?.action;
  if (action === "quit") {
    app.quit();
  }
});
