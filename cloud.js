/* MYMD 云同步模块：密码门 + GitHub 双向同步 + Token 设置。
   本地 localStorage 永远是工作区；云端是同步副本，双向按 updated 时间戳合并。 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var UNLOCK_KEY = 'mymd_unlocked';
  var TOKEN_KEY = 'mymd_pat';
  var META_KEY = 'mymd.cloud.v1';
  var MAX_PULL = 80;          // 一次最多拉取的云端笔记数，防止失控

  var syncing = false;
  var autoTimer = null;
  var statusTimer = null;
  var meta = {};              // { 本地笔记id: { name, sha, path, updated } }
  try { meta = JSON.parse(localStorage.getItem(META_KEY) || '{}') || {}; } catch (e) { meta = {}; }

  var API = 'https://api.github.com/repos/' + CONFIG.owner + '/' + CONFIG.repo +
            '/contents/' + CONFIG.notesDir;

  function token() { return localStorage.getItem(TOKEN_KEY) || ''; }
  function app() { return window.MDApp; }

  function saveMeta() {
    try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) {}
  }

  function clock(ts) {
    var d = new Date(ts || Date.now());
    return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  }

  function setStatus(text, sticky) {
    var el = $('cloudState');
    if (!el) return;
    el.textContent = text;
    clearTimeout(statusTimer);
    if (!sticky && text) statusTimer = setTimeout(function () { el.textContent = ''; }, 4000);
  }

  /* ---------- Base64（UTF-8 安全） ---------- */

  function b64encode(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function b64decode(b64) {
    var bin = atob(String(b64 || '').replace(/\n/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /* ---------- GitHub API ---------- */

  function gh(path, options) {
    options = options || {};
    var headers = { Accept: 'application/vnd.github+json' };
    if (options.headers) for (var k in options.headers) headers[k] = options.headers[k];
    if (token()) headers.Authorization = 'Bearer ' + token();
    return fetch(path, { method: options.method || 'GET', headers: headers, body: options.body || undefined })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok) {
            var err = new Error(body.message || ('GitHub API ' + res.status));
            err.status = res.status;
            throw err;
          }
          return body;
        });
      });
  }

  /* ---------- 云端文件格式 ----------
     首行: <!-- mymd:{"id":"..","updated":..,"pinned":..,"title":"encodeURIComponent(标题)"} -->
     之后: 笔记正文。首行注释在 Markdown 渲染中不可见，导出/备份时会被剥掉。 */

  function noteFile(note) {
    var slug = String(note.title || '').replace(/[\\/:*?"<>|#\u0000-\u001f]+/g, '-')
      .replace(/\s+/g, ' ').trim().slice(0, 40).replace(/^-+|-+$/g, '');
    return (slug || '无标题') + '-' + note.id + '.md';
  }

  function noteText(note) {
    var info = {
      id: note.id,
      updated: note.updated || Date.now(),
      pinned: !!note.pinned,
      title: encodeURIComponent(note.title || '')
    };
    return '<!-- mymd:' + JSON.stringify(info) + " -->\n" + String(note.body || '');
  }

  function parseCloudText(text, fallbackName) {
    var t = String(text || '').replace(/^\uFEFF/, '');
    var m = t.match(/^<!-- mymd:([\s\S]*?) -->\n?/);
    var info = {};
    if (m) { try { info = JSON.parse(m[1]) || {}; } catch (e) { info = {}; } }
    var body = m ? t.slice(m[0].length) : t;
    var title = '';
    try { title = decodeURIComponent(info.title || ''); } catch (e) { title = String(info.title || ''); }
    return {
      id: String(info.id || 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
      title: title || String(fallbackName || '').replace(/\.md$/, ''),
      body: body,
      updated: +info.updated || Date.now(),
      pinned: !!info.pinned
    };
  }

  /* ---------- 双向同步 ---------- */

  function findLocal(id) {
    var notes = app().data.notes;
    for (var i = 0; i < notes.length; i++) if (notes[i].id === id) return notes[i];
    return null;
  }

  function syncAll(manual) {
    if (syncing) return Promise.resolve();
    var A = app();
    if (!A) return Promise.resolve();
    if (!token()) {
      if (manual) { openCfg(); A.toast('先填入 GitHub Token 才能同步'); }
      return Promise.resolve();
    }

    syncing = true;
    setStatus('☁️ 同步中…', true);

    var changed = false;

    /* 1. 拉取云端文件列表（目录不存在视为空） */
    var listing = null;
    return gh(API + '?ref=' + CONFIG.branch).catch(function (e) {
      if (e.status === 404) return [];
      throw e;
    }).then(function (list) {
      listing = Array.isArray(list) ? list : [];
      var remoteByName = {};
      listing.forEach(function (f) { if (/\.md$/i.test(f.name)) remoteByName[f.name] = f; });

      /* 2. 远端文件被删（别的设备删的）：本地对应笔记也收进回收站 */
      Object.keys(meta).forEach(function (id) {
        var m = meta[id];
        var local = findLocal(id);
        if (!local || !m.name) return;
        if (!remoteByName[m.name]) {
          local.deletedAt = Date.now();
          A.data.notes = A.data.notes.filter(function (n) { return n.id !== id; });
          A.data.trash.push(local);
          delete meta[id];
          changed = true;
        }
      });

      /* 3. 下载远端内容，按 updated 合并 */
      var names = Object.keys(remoteByName).slice(0, MAX_PULL);
      var seq = Promise.resolve();
      names.forEach(function (name) {
        seq = seq.then(function () {
          var f = remoteByName[name];
          return gh(API + '/' + name + '?ref=' + CONFIG.branch).then(function (data) {
            var rn = parseCloudText(b64decode(data.content), f.name);
            var local = findLocal(rn.id);
            if (!local) {
              A.data.notes.push(A.normalizeNote({
                id: rn.id, title: rn.title, body: rn.body,
                created: rn.updated, updated: rn.updated, pinned: rn.pinned
              }));
              meta[rn.id] = { name: name, sha: f.sha, path: f.path, updated: rn.updated };
              changed = true;
            } else if (rn.updated > local.updated) {
              local.title = rn.title; local.body = rn.body;
              local.pinned = rn.pinned; local.updated = rn.updated;
              meta[rn.id] = { name: name, sha: f.sha, path: f.path, updated: rn.updated };
              changed = true;
            } else {
              meta[rn.id] = { name: name, sha: f.sha, path: f.path, updated: local.updated };
            }
          }).catch(function () { /* 单篇失败不挡整体 */ });
        });
      });
      return seq;
    }).then(function () {
      /* 4. 推送本地笔记（新笔记 / 本地更新的） */
      var notes = A.data.notes.slice().sort(function (a, b) { return (a.updated || 0) - (b.updated || 0); });
      /* 云端还一篇都没有、本地只有初始欢迎页时，不把欢迎页推上去 */
      var pullable = Object.keys(meta).length > 0;
      var pushSeq = Promise.resolve();
      notes.forEach(function (note) {
        pushSeq = pushSeq.then(function () {
          var m = meta[note.id];
          if (m && m.updated >= (note.updated || 0)) return;
          if (!pullable && notes.length === 1 && note.body === A.seedWelcomeBody) return;

          var fname = noteFile(note);
          var oldPath = m && m.path;
          var oldSha = m && m.sha;
          return gh(API + '/' + fname, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: 'MYMD 同步：' + A.derivedTitle(note),
              content: b64encode(noteText(note)),
              branch: CONFIG.branch
            })
          }).then(function (res) {
            meta[note.id] = { name: fname, sha: res.content.sha, path: res.content.path, updated: note.updated || Date.now() };
            changed = true;
            if (oldPath && oldPath !== res.content.path) {
              /* 改过标题 → 文件名变了，删掉云端的旧文件 */
              var oldName = oldPath.split('/').pop();
              var del = function (sha) {
                return gh(API + '/' + oldName, {
                  method: 'DELETE',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ message: 'MYMD 同步：清理旧文件', sha: sha, branch: CONFIG.branch })
                });
              };
              del(oldSha).catch(function () {
                return gh(API + '/' + oldName + '?ref=' + CONFIG.branch).then(function (cur) {
                  return del(cur.sha);
                });
              }).catch(function () { /* 清理失败不挡同步 */ });
            }
          }).catch(function (e) {
            setStatus('☁️ 「' + A.derivedTitle(note) + '」推送失败：' + e.message, true);
          });
        });
      });
      return pushSeq;
    }).then(function () {
      /* 5. 本地已删除（回收站/彻底删）的笔记，云端一并删除 */
      var delSeq = Promise.resolve();
      Object.keys(meta).forEach(function (id) {
        if (findLocal(id)) return;
        delSeq = delSeq.then(function () {
          var m = meta[id];
          var del = function (sha) {
            return gh(API + '/' + m.name, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: 'MYMD 同步：删除笔记', sha: sha, branch: CONFIG.branch })
            });
          };
          return del(m.sha).catch(function () {
            return gh(API + '/' + m.name + '?ref=' + CONFIG.branch).then(function (cur) { return del(cur.sha); });
          }).then(function () {
            delete meta[id];
            changed = true;
          }).catch(function () { /* 删除失败下次再试 */ });
        });
      });
      return delSeq;
    }).then(function () {
      saveMeta();
      if (changed) { app().persist(); app().paint(); }
      setStatus('☁️ 已同步 ' + clock(), true);
      if (manual) app().toast('已与 GitHub 同步');
    }).catch(function (e) {
      setStatus('☁️ 同步失败：' + e.message, true);
      if (manual) app().toast('同步失败：' + e.message);
    }).then(function () {
      syncing = false;
    });
  }

  /* 本地保存后自动同步（8 秒防抖，攒一批一起推） */
  function onLocalSave() {
    if (!token()) return;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(function () { syncAll(false); }, 8000);
  }

  /* ---------- 密码门 ---------- */

  function sha256Hex(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      var arr = new Uint8Array(buf), out = '';
      for (var i = 0; i < arr.length; i++) out += ('0' + arr[i].toString(16)).slice(-2);
      return out;
    });
  }
  window.__genHash = sha256Hex; /* 控制台改密码用：__genHash("新密码") */

  function enterApp() {
    $('gate').classList.add('hidden');
    if (token()) syncAll(false);
    else setStatus('☁️ 未配置 Token，点 ⚙️ 设置', true);
  }

  function tryUnlock() {
    /* 中文输入法可能打出全角空格（U+3000），统一按普通空格处理 */
    var pwd = $('gatePwd').value.replace(/\u3000/g, ' ');
    if (!pwd) return;
    sha256Hex(pwd).then(function (hash) {
      if (hash === CONFIG.passwordHash) {
        sessionStorage.setItem(UNLOCK_KEY, '1');
        enterApp();
      } else {
        $('gateErr').textContent = '密码不对，再试试';
        $('gatePwd').value = '';
        $('gatePwd').focus();
      }
    });
  }

  function lockApp() {
    sessionStorage.removeItem(UNLOCK_KEY);
    location.reload();
  }

  /* ---------- 设置 ---------- */

  function openCfg() {
    $('patInput').value = token();
    $('cfgPanel').hidden = false;
    $('patInput').focus();
  }
  function closeCfg() { $('cfgPanel').hidden = true; }
  function saveCfg() {
    localStorage.setItem(TOKEN_KEY, $('patInput').value.trim());
    closeCfg();
    app().toast('Token 已保存');
    syncAll(false);
  }

  /* ---------- 事件绑定与启动 ---------- */

  function boot() {
    var rn = $('cfgRepoName');
    if (rn) rn.textContent = CONFIG.owner + '/' + CONFIG.repo;
    $('gateBtn').addEventListener('click', tryUnlock);
    $('gatePwd').addEventListener('keydown', function (e) { if (e.key === 'Enter') tryUnlock(); });
    $('cloudBtn').addEventListener('click', function () { syncAll(true); });
    $('cfgBtn').addEventListener('click', openCfg);
    $('cfgClose').addEventListener('click', closeCfg);
    $('cfgSave').addEventListener('click', saveCfg);
    $('cfgPanel').addEventListener('click', function (e) { if (e.target === $('cfgPanel')) closeCfg(); });
    $('lockBtn').addEventListener('click', lockApp);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeCfg(); });

    if (sessionStorage.getItem(UNLOCK_KEY) === '1') enterApp();
    else $('gatePwd').focus();
  }

  window.MDCloud = { boot: boot, syncAll: syncAll, onLocalSave: onLocalSave };
})();
