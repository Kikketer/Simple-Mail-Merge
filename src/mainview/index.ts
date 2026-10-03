import { Electroview } from "electrobun/view";
import type {
  AppRPC,
  HistoryMeta,
  Recipient,
  SavedState,
} from "../shared/rpc";

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const editor = $("editor");
const sendBtn = $("send") as HTMLButtonElement;
const log = $("log");
const progressBar = $("progress") as HTMLProgressElement;
const progressText = $("progress-text");

let recipients: Recipient[] = [];
let sending = false;

const rpc = Electroview.defineRPC<AppRPC>({
  handlers: {
    requests: {},
    messages: {
      sendProgress: ({ index, total, email, ok, error }) => {
        progressBar.max = total;
        progressBar.value = index + 1;
        progressText.textContent = `${index + 1} / ${total}`;
        const line = document.createElement("div");
        if (ok) {
          line.textContent = `✓ ${email}`;
        } else {
          line.className = "fail";
          line.textContent = `✗ ${email} — ${error}`;
        }
        log.appendChild(line);
        log.scrollTop = log.scrollHeight;
      },
    },
  },
});

new Electroview({ rpc });

// --- Persistence ---
const STORE_KEY = "bulkmailer.state";

let dirty = false;
const saveIndicator = $("save-indicator");
const historySelect = $("history") as HTMLSelectElement;

function renderHistorySelect(entries: HistoryMeta[]) {
  historySelect.innerHTML =
    '<option value="">History</option>' +
    entries
      .map((e) => {
        const label = e.subject || "(no subject)";
        return `<option value="${e.id}">${escapeHtml(label)}</option>`;
      })
      .join("");
}

function currentState(): SavedState {
  return {
    user: ($("user") as HTMLInputElement).value,
    password: ($("password") as HTMLInputElement).value,
    fromName: ($("from-name") as HTMLInputElement).value,
    fromEmail: ($("from-email") as HTMLInputElement).value,
    subject: ($("subject") as HTMLInputElement).value,
    html: editor.innerHTML,
    delay: Number(($("delay") as HTMLInputElement).value) || 0,
    recipients,
  };
}

function applyState(s: Partial<SavedState>) {
  ($("user") as HTMLInputElement).value = s.user ?? "";
  ($("password") as HTMLInputElement).value = s.password ?? "";
  ($("from-name") as HTMLInputElement).value = s.fromName ?? "";
  ($("from-email") as HTMLInputElement).value = s.fromEmail ?? "";
  ($("subject") as HTMLInputElement).value = s.subject ?? "";
  editor.innerHTML = s.html ?? "";
  if (s.delay != null)
    ($("delay") as HTMLInputElement).value = String(s.delay);
  if (Array.isArray(s.recipients)) recipients = s.recipients;
}

function saveState() {
  if (!dirty) return;
  dirty = false;
  const state = currentState();
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  saveIndicator.textContent = "Saved";
  saveIndicator.classList.remove("unsaved");
}

function markDirty() {
  dirty = true;
  saveIndicator.textContent = "Unsaved changes";
  saveIndicator.classList.add("unsaved");
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw) as Partial<SavedState>;
    applyState(s);
  } catch {
    // ignore corrupt state
  }
}

[
  "user",
  "password",
  "from-name",
  "from-email",
  "subject",
  "delay",
].forEach((id) => $(id).addEventListener("input", markDirty));
editor.addEventListener("input", markDirty);

setInterval(saveState, 10_000);
window.addEventListener("beforeunload", () => {
  dirty = true;
  saveState();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    dirty = true;
    saveState();
  }
});

// --- Editor toolbar ---
document.querySelectorAll<HTMLButtonElement>("[data-cmd]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.execCommand(btn.dataset.cmd!, false);
    editor.focus();
    saveState();
  });
});

$("format-block").addEventListener("change", (e) => {
  document.execCommand(
    "formatBlock",
    false,
    (e.target as HTMLSelectElement).value,
  );
  editor.focus();
  markDirty();
});

// --- Link popover ---
const linkPopover = $("link-popover");
const linkUrl = $("link-url") as HTMLInputElement;
let savedRange: Range | null = null;

function saveSelection() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
    savedRange = sel.getRangeAt(0).cloneRange();
  }
}

function restoreSelection() {
  if (!savedRange) return;
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(savedRange);
}

editor.addEventListener("keyup", saveSelection);
editor.addEventListener("mouseup", saveSelection);
editor.addEventListener("blur", saveSelection);

function openLinkPopover() {
  saveSelection();
  const selectedText = savedRange?.toString().trim() ?? "";
  linkUrl.value = /^https?:\/\/\S+$/i.test(selectedText) ? selectedText : "";
  linkPopover.classList.remove("hidden");
  linkUrl.focus();
}

$("link").addEventListener("click", openLinkPopover);

// --- Editor keyboard shortcuts ---
editor.addEventListener("keydown", (e) => {
  if (!e.metaKey) return;
  const key = e.key.toLowerCase();
  const cmd = e.shiftKey
    ? { s: "strikeThrough", x: "removeFormat", "7": "insertOrderedList", "8": "insertUnorderedList" }[key]
    : { b: "bold", i: "italic", u: "underline" }[key];

  if (key === "k" && !e.shiftKey) {
    e.preventDefault();
    openLinkPopover();
    return;
  }
  if (!cmd) return;
  e.preventDefault();
  document.execCommand(cmd, false);
  markDirty();
});

function hideLinkPopover() {
  linkPopover.classList.add("hidden");
  savedRange = null;
}

$("link-apply").addEventListener("click", () => {
  let url = linkUrl.value.trim();
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  if (url) {
    restoreSelection();
    document.execCommand("createLink", false, url);
    markDirty();
  }
  hideLinkPopover();
  editor.focus();
});

$("link-remove").addEventListener("click", () => {
  restoreSelection();
  document.execCommand("unlink", false);
  markDirty();
  hideLinkPopover();
  editor.focus();
});

linkUrl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    $("link-apply").click();
  } else if (e.key === "Escape") {
    hideLinkPopover();
    editor.focus();
  }
});

document.addEventListener("mousedown", (e) => {
  if (
    !linkPopover.classList.contains("hidden") &&
    !linkPopover.contains(e.target as Node) &&
    e.target !== $("link")
  ) {
    hideLinkPopover();
  }
});

// --- Settings modal ---
const settingsModal = $("settings-modal");
$("settings-open").addEventListener("click", () =>
  settingsModal.classList.remove("hidden"),
);
$("settings-close").addEventListener("click", () =>
  settingsModal.classList.add("hidden"),
);
settingsModal.addEventListener("mousedown", (e) => {
  if (e.target === settingsModal) settingsModal.classList.add("hidden");
});

// --- Recipients flyout ---
const sendPanel = $("send-panel");
const backdrop = $("backdrop");

function closeFlyout() {
  sendPanel.classList.remove("open");
  backdrop.classList.remove("visible");
}

$("recipients-toggle").addEventListener("click", () => {
  sendPanel.classList.add("open");
  backdrop.classList.add("visible");
});
$("recipients-close").addEventListener("click", closeFlyout);
backdrop.addEventListener("click", closeFlyout);

// --- CSV parsing ---
function parseCsv(text: string): Recipient[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);

  if (rows.length === 0) return [];

  // Require a header row with Name and Email columns; ignore all other columns
  const header = rows[0].map((f) => f.trim().toLowerCase());
  const nameIdx = header.indexOf("name");
  const emailIdx = header.indexOf("email");
  if (nameIdx === -1 || emailIdx === -1) {
    throw new Error(
      'CSV must have a header row with "Name" and "Email" columns.',
    );
  }
  rows.shift();

  return rows
    .map((r) => ({
      name: (r[nameIdx] ?? "").trim(),
      email: (r[emailIdx] ?? "").trim(),
    }))
    .filter((r) => r.email.includes("@"));
}

function renderRecipients() {
  const list = $("recipient-list");
  if (recipients.length === 0) {
    list.innerHTML = "<div class='hint'>No recipients loaded.</div>";
  } else {
    list.innerHTML =
      "<table>" +
      recipients
        .map(
          (r, i) =>
            `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.email)}</td>` +
            `<td class="del"><button class="del-btn" data-idx="${i}" title="Remove">✕</button></td></tr>`,
        )
        .join("") +
      "</table>";
  }
  sendBtn.disabled = recipients.length === 0 || sending;
}

$("recipient-list").addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".del-btn");
  if (!btn) return;
  recipients.splice(Number(btn.dataset.idx), 1);
  renderRecipients();
  markDirty();
});

function addRecipient() {
  const nameEl = $("add-name") as HTMLInputElement;
  const emailEl = $("add-email") as HTMLInputElement;
  const name = nameEl.value.trim();
  const email = emailEl.value.trim();
  if (!email.includes("@")) {
    emailEl.focus();
    return;
  }
  recipients.push({ name, email });
  nameEl.value = "";
  emailEl.value = "";
  nameEl.focus();
  renderRecipients();
  markDirty();
}

$("add-btn").addEventListener("click", addRecipient);
$("add-email").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addRecipient();
});
$("add-name").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addRecipient();
});

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

$("csv").addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const input = e.target as HTMLInputElement;
  try {
    recipients = parseCsv(await file.text());
    progressText.textContent = `Loaded ${recipients.length} recipient(s) from ${file.name}.`;
  } catch (err) {
    recipients = [];
    progressText.textContent = `CSV error: ${(err as Error).message}`;
  }
  input.value = "";
  renderRecipients();
  markDirty();
});

// --- Verify & Send ---
$("verify").addEventListener("click", async () => {
  const status = $("verify-status");
  status.textContent = "Verifying…";
  status.className = "status";
  const res = await rpc.request.verifyCredentials({
    user: ($("user") as HTMLInputElement).value.trim(),
    password: ($("password") as HTMLInputElement).value,
  });
  status.textContent = res.ok ? "Credentials OK" : `Failed: ${res.error}`;
  status.className = res.ok ? "status ok" : "status err";
});

// --- Confirm & Send ---
const confirmModal = $("confirm-modal");

sendBtn.addEventListener("click", () => {
  const user = ($("user") as HTMLInputElement).value.trim();
  const password = ($("password") as HTMLInputElement).value;
  const subject = ($("subject") as HTMLInputElement).value;
  const html = editor.innerHTML.trim();

  if (!user || !password) {
    progressText.textContent = "Configure your account in Settings first.";
    settingsModal.classList.remove("hidden");
    return;
  }
  if (!subject || !html) {
    progressText.textContent = "Add a subject and body first.";
    return;
  }

  const fromEmail = ($("from-email") as HTMLInputElement).value.trim();
  const fromName = ($("from-name") as HTMLInputElement).value.trim();
  $("confirm-text").textContent =
    `Send "${subject}" to ${recipients.length} recipient(s) ` +
    `from ${fromName ? `${fromName} ` : ""}<${fromEmail || user}>?`;
  confirmModal.classList.remove("hidden");
});

$("confirm-cancel").addEventListener("click", () =>
  confirmModal.classList.add("hidden"),
);
confirmModal.addEventListener("mousedown", (e) => {
  if (e.target === confirmModal) confirmModal.classList.add("hidden");
});

$("confirm-send").addEventListener("click", async () => {
  confirmModal.classList.add("hidden");

  const user = ($("user") as HTMLInputElement).value.trim();
  const password = ($("password") as HTMLInputElement).value;
  const fromEmail = ($("from-email") as HTMLInputElement).value.trim();
  const subject = ($("subject") as HTMLInputElement).value;
  const html = editor.innerHTML.trim();

  sending = true;
  sendBtn.disabled = true;
  sendBtn.textContent = "Sending…";
  log.innerHTML = "";
  progressBar.value = 0;
  progressBar.max = recipients.length;
  progressText.textContent = `Sending 0 / ${recipients.length}…`;
  closeFlyout();

  try {
    const res = await rpc.request.sendBatch(
      {
        user,
        password,
        fromName: ($("from-name") as HTMLInputElement).value.trim(),
        fromEmail,
        subject,
        html,
        text: editor.innerText,
        recipients,
        delayMs: Number(($("delay") as HTMLInputElement).value) || 0,
      },
      { maxRequestTime: Infinity },
    );
    progressText.textContent = `Done — ${res.sent} sent, ${res.failed} failed.`;
    rpc.request
      .pushHistory({ state: currentState() })
      .then((r) => {
        renderHistorySelect(r.entries);
        historySelect.value = r.entries[0]?.id ?? "";
      })
      .catch(() => {});
  } catch (err) {
    progressText.textContent = `Error: ${err}`;
    const line = document.createElement("div");
    line.className = "fail";
    line.textContent = `Send failed: ${err}`;
    log.appendChild(line);
  } finally {
    sending = false;
    sendBtn.textContent = "Send";
    renderRecipients();
  }
});

historySelect.addEventListener("change", async () => {
  const id = historySelect.value;
  if (!id) return;
  const res = await rpc.request.getHistoryEntry({ id });
  if (!res.entry) return;
  applyState(res.entry);
  renderRecipients();
  dirty = true;
  saveState();
});

loadState();
renderRecipients();
rpc.request
  .listHistory({})
  .then((res) => renderHistorySelect(res.entries))
  .catch(() => {});
