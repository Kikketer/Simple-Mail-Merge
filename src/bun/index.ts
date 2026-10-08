import {
  app,
  BrowserView,
  BrowserWindow,
  ApplicationMenu,
  Utils,
} from "electrobun/main";
import nodemailer from "nodemailer";
import juice from "juice";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import pkg from "../../package.json";
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

// Wrap the sanitized fragment in an email document and inline a base
// stylesheet. Clients that ignore semantic tag defaults (Spark iOS shows
// h1 as plain bold text) still get explicit styling on every element.
const EMAIL_CSS = `
  body { margin: 0; padding: 16px; font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.5; color: #000000; }
  h1 { font-size: 28px; font-weight: bold; margin: 0 0 16px; }
  h2 { font-size: 22px; font-weight: bold; margin: 0 0 12px; }
  h3 { font-size: 18px; font-weight: bold; margin: 0 0 10px; }
  p { margin: 0 0 16px; }
  div { margin: 0; }
  ul, ol { margin: 0 0 16px; padding-left: 24px; }
  li { margin: 0 0 4px; }
  a { color: #1a6ef5; text-decoration: underline; }
`;

function buildEmailHtml(bodyHtml: string): string {
  const doc = `<!DOCTYPE html>
<html>
  <head>
    <meta http-equiv="content-type" content="text/html; charset=UTF-8">
    <style>${EMAIL_CSS}</style>
  </head>
  <body text="#000000" bgcolor="#FFFFFF">
${bodyHtml}
  </body>
</html>`;
  return juice(doc);
}

// RFC2047-encode a header value when it contains non-ASCII characters.
function encodeHeader(value: string): string {
  return /[^\x00-\x7f]/.test(value)
    ? `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`
    : value;
}

function formatAddress(name: string, email: string): string {
  const cleaned = name.replace(/["<>]/g, "").trim();
  return cleaned ? `"${cleaned}" <${email}>` : email;
}

// RFC2822 date with numeric zone offset, matching Thunderbird's format.
function formatMessageDate(d: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const p = (n: number) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const zone = `${sign}${p(Math.floor(Math.abs(off) / 60))}${p(Math.abs(off) % 60)}`;
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${zone}`;
}

// Build a raw RFC822 message mirroring what Thunderbird produces: single
// text/html part with 8bit encoding. Some clients (Spark iOS) only render
// rich formatting for 8bit bodies. All line endings must be CRLF — bare LF
// in the DATA payload gets rejected by strict relays (iCloud 550 CS101).
function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|h[1-6]|li|ul|ol)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&quot;/gi, (m) => (m === "&quot;" ? '"' : "'"))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildRawMessage(opts: {
  from: string;
  to: string;
  subject: string;
  html: string;
  domain: string;
}): string {
  const boundary = `b1_${crypto.randomUUID().replace(/-/g, "")}`;
  const headers = [
    `Message-ID: <${crypto.randomUUID()}@${opts.domain}>`,
    `Date: ${formatMessageDate(new Date())}`,
    `MIME-Version: 1.0`,
    `User-Agent: Mozilla Thunderbird`,
    `Content-Language: en-US`,
    `To: ${opts.to}`,
    `From: ${opts.from}`,
    `Subject: ${encodeHeader(opts.subject)}`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const plain = wrapHtmlLines(
    htmlToText(opts.html).replace(/\r?\n/g, "\r\n"),
  );
  const body = wrapHtmlLines(opts.html.replace(/\r?\n/g, "\r\n"));
  const parts = [
    `--${boundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    plain,
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    body,
    `--${boundary}--`,
  ];
  return headers.join("\r\n") + "\r\n\r\n" + parts.join("\r\n") + "\r\n";
}

// SMTP allows max 998 chars/line; editor HTML is one long line and iCloud
// rejects oversize lines (550 CS101). Break at safe points — whitespace
// between tags or just after '>' — never inside a tag.
const SMTP_LINE_MAX = 900;

function wrapHtmlLines(html: string): string {
  const out: string[] = [];
  for (const rawLine of html.split("\r\n")) {
    let line = rawLine;
    while (line.length > SMTP_LINE_MAX) {
      // Prefer breaking right after a tag close; otherwise at whitespace.
      let cut = line.lastIndexOf(">", SMTP_LINE_MAX) + 1;
      if (cut <= 0) cut = line.lastIndexOf(" ", SMTP_LINE_MAX) + 1;
      if (cut <= 0) cut = SMTP_LINE_MAX;
      out.push(line.slice(0, cut).trimEnd());
      line = line.slice(cut).trimStart();
    }
    out.push(line);
  }
  return out.join("\r\n");
}

const rpc = BrowserView.defineRPC<AppRPC>({
  handlers: {
    requests: {
      getAppInfo: async () => ({
        name: "Simple Mail Merge",
        version: pkg.version,
        url: "https://cjweed.com/Simple-Mail-Merge",
      }),
      openExternal: async ({ url }) => {
        Utils.openExternal(url);
        return {};
      },
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
        const html = buildEmailHtml(params.html);
        const fromAddress = params.fromEmail || params.user;
        const from = formatAddress(params.fromName, fromAddress);
        const domain = fromAddress.split("@")[1] || "localhost";
        let sent = 0;
        let failed = 0;

        for (let i = 0; i < params.recipients.length; i++) {
          const r = params.recipients[i];
          try {
            // Thunderbird-style raw message: single text/html part, 8bit.
            // Some clients (Spark iOS) only render rich formatting for
            // 8bit bodies; nodemailer can't emit 8bit, so we build it.
            const raw = buildRawMessage({
              from,
              to: formatAddress(r.name, r.email),
              subject: params.subject,
              html,
              domain,
            });
            await transporter.sendMail({
              envelope: { from: fromAddress, to: r.email },
              raw,
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
