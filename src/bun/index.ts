import {
  app,
  BrowserView,
  BrowserWindow,
  ApplicationMenu,
} from "electrobun/main";
import nodemailer from "nodemailer";
import type { AppRPC, SendBatchParams } from "../shared/rpc";

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
    },
    messages: {},
  },
});

new BrowserWindow({
  title: "Bulk Mailer",
  url: "views://mainview/index.html",
  frame: { width: 1000, height: 750 },
  rpc,
});

ApplicationMenu.setApplicationMenu([
  {
    label: "Bulk Mailer",
    submenu: [
      {
        label: "Quit Bulk Mailer",
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
