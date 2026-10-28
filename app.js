/* ===== MYMD 主逻辑 ===== */
"use strict";

/* ---------- 工具 ---------- */
const $ = (id) => document.getElementById(id);

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach(b => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

function b64decode(b64) {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// 控制台辅助：__genHash("新密码") 生成哈希，替换 config.js 里的 passwordHash
window.__genHash = sha256Hex;

/* ---------- 状态 ---------- */
const API = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents`;
const state = {
  notes: [],          // [{name, sha, path}]
  current: null,      // 当前笔记文件名
  currentSha: null,   // 当前笔记的 git blob sha
  dirty: false,
  preview: false,
  saveTimer: null,
};

/* ---------- 密码门 ---------- */
const UNLOCK_KEY = "mymd_unlocked";

async function tryUnlock() {
  const pwd = $("gate-pwd").value;
  if (!pwd) return;
  const hash = await sha256Hex(pwd);
  if (hash === CONFIG.passwordHash) {
    sessionStorage.setItem(UNLOCK_KEY, "1");
    enterApp();
  } else {
    $("gate-err").textContent = "密码不对，再试试";
    $("gate-pwd").value = "";
    $("gate-pwd").focus();
  }
}

function enterApp() {
  $("gate").classList.add("hidden");
  $("app").classList.remove("hidden");
  $("welcome-repo").textContent = `${CONFIG.owner}/${CONFIG.repo}`;
  loadNoteList();
}

/* ---------- GitHub API ---------- */
function getToken() { return localStorage.getItem("mymd_pat") || ""; }

async function ghFetch(path, options = {}) {
  const headers = { Accept: "application/vnd.github+json" };
  if (getToken()) headers.Authorization = `Bearer ${getToken()}`;
  const res = await fetch(path, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `GitHub API ${res.status}`);
  }
  return res.json();
}

/* ---------- 笔记列表 ---------- */
async function loadNoteList() {
  $("list-loading").classList.remove("hidden");
  $("note-list").innerHTML = "";
  try {
    const data = await ghFetch(`${API}/${CONFIG.notesDir}?ref=${CONFIG.branch}`);
    state.notes = Array.isArray(data) ? data.filter(f => f.name.endsWith(".md")) : [];
    renderNoteList();
  } catch (e) {
    $("list-loading").textContent = "加载失败：" + e.message + "（公开仓库可匿名读取，检查仓库名/目录是否正确）";
  }
  $("list-loading").classList.add("hidden");
}

function renderNoteList() {
  const ul = $("note-list");
  ul.innerHTML = "";
  state.notes.forEach(n => {
    const li = document.createElement("li");
    li.textContent = n.name.replace(/\.md$/, "");
    li.title = n.name;
    if (state.current === n.name) li.classList.add("active");
    li.onclick = () => openNote(n);
    ul.appendChild(li);
  });
  if (!state.notes.length) {
    ul.innerHTML = '<li style="color:var(--text-2);cursor:default">还没有笔记</li>';
  }
}

/* ---------- 打开 / 新建 ---------- */
async function openNote(note) {
  if (state.dirty && !confirm("当前笔记有未保存的修改，确定离开？")) return;
  try {
    const data = await ghFetch(`${API}/${note.path}?ref=${CONFIG.branch}`);
    state.current = note.name;
    state.currentSha = data.sha;
    $("note-title").value = note.name.replace(/\.md$/, "");
    $("note-content").value = b64decode(data.content);
    state.dirty = false;
    showEditor();
    renderNoteList();
  } catch (e) {
    alert("读取失败：" + e.message);
  }
}

function newNote() {
  if (state.dirty && !confirm("当前笔记有未保存的修改，确定离开？")) return;
  state.current = null;
  state.currentSha = null;
  state.dirty = false;
  $("note-title").value = "";
  $("note-content").value = "";
  showEditor();
  $("note-title").focus();
}

function showEditor() {
  $("welcome").classList.add("hidden");
  $("editor").classList.remove("hidden");
  setPreview(false);
}

/* ---------- 保存 ---------- */
function sanitizeFilename(title) {
  const name = (title || "").trim().replace(/[\\/:*?"<>|#\s]+/g, "-").replace(/^-+|-+$/g, "");
  return name || "untitled";
}

async function saveNote() {
  const token = getToken();
  if (!token) {
    openSettings();
    alert("请先在设置里填入 GitHub Token 才能保存");
    return;
  }
  const base = sanitizeFilename($("note-title").value);
  const path = `${CONFIG.notesDir}/${base}.md`;
  const content = $("note-content").value;
  const body = {
    message: `笔记: ${base} (${new Date().toLocaleString("zh-CN")})`,
    content: b64encode(content),
    branch: CONFIG.branch,
  };
  // 更新已有文件必须带原 sha；改了名字相当于新建 + 提示删除旧文件
  if (state.current === `${base}.md`) body.sha = state.currentSha;

  setSaveStatus("保存中…");
  try {
    const res = await ghFetch(`${API}/${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    // 改名：删除旧文件
    if (state.current && state.current !== `${base}.md`) {
      await ghFetch(`${API}/${CONFIG.notesDir}/${state.current}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: `重命名: ${state.current} → ${base}.md`, sha: state.currentSha, branch: CONFIG.branch }),
      });
    }
    state.current = `${base}.md`;
    state.currentSha = res.content.sha;
    state.dirty = false;
    setSaveStatus("✓ 已保存到 GitHub");
    loadNoteList();
  } catch (e) {
    setSaveStatus("");
    alert("保存失败：" + e.message + (e.message.includes("Bad credentials") ? "\n请检查设置里的 Token" : ""));
  }
}

// 防抖自动保存：停止输入 2 秒后自动保存
function scheduleAutosave() {
  state.dirty = true;
  setSaveStatus("● 未保存");
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => { if (state.current) saveNote(); }, 2000);
}

function setSaveStatus(text) { $("save-status").textContent = text; }

/* ---------- 删除 ---------- */
async function deleteNote() {
  if (!state.current) return;
  if (!confirm(`确定删除「${state.current.replace(/\.md$/, "")}」？此操作会在 GitHub 上提交一次删除。`)) return;
  try {
    await ghFetch(`${API}/${CONFIG.notesDir}/${state.current}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: `删除笔记: ${state.current}`, sha: state.currentSha, branch: CONFIG.branch }),
    });
    state.current = null; state.currentSha = null; state.dirty = false;
    $("editor").classList.add("hidden");
    $("welcome").classList.remove("hidden");
    loadNoteList();
  } catch (e) {
    alert("删除失败：" + e.message);
  }
}

/* ---------- 预览 ---------- */
function setPreview(on) {
  state.preview = on;
  $("preview-pane").classList.toggle("hidden", !on);
  $("note-content").classList.toggle("hidden", on);
  $("btn-preview").textContent = on ? "编辑" : "预览";
  if (on) renderPreview();
}

function renderPreview() {
  const raw = marked.parse($("note-content").value || "");
  $("preview-pane").innerHTML = DOMPurify.sanitize(raw);
}

/* ---------- 设置 ---------- */
function openSettings() {
  $("pat-input").value = getToken();
  $("settings-modal").classList.remove("hidden");
}

function closeSettings() { $("settings-modal").classList.add("hidden"); }

/* ---------- 锁定 ---------- */
function lockApp() {
  sessionStorage.removeItem(UNLOCK_KEY);
  location.reload();
}

/* ---------- 事件绑定 ---------- */
$("gate-btn").onclick = tryUnlock;
$("gate-pwd").addEventListener("keydown", e => { if (e.key === "Enter") tryUnlock(); });

$("btn-new").onclick = newNote;
$("btn-save").onclick = saveNote;
$("btn-delete").onclick = deleteNote;
$("btn-preview").onclick = () => setPreview(!state.preview);
$("btn-lock").onclick = lockApp;
$("btn-settings").onclick = openSettings;
$("settings-cancel").onclick = closeSettings;
$("settings-save").onclick = () => {
  localStorage.setItem("mymd_pat", $("pat-input").value.trim());
  closeSettings();
};

$("note-content").addEventListener("input", scheduleAutosave);
$("note-content").addEventListener("keydown", e => {
  if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); clearTimeout(state.saveTimer); saveNote(); }
});
$("note-content").addEventListener("blur", () => { if (state.preview) renderPreview(); });

/* ---------- 启动 ---------- */
if (sessionStorage.getItem(UNLOCK_KEY) === "1") {
  enterApp();
} else {
  $("gate-pwd").focus();
}
