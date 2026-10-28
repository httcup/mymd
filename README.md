# MYMD · 随手记存为.md

私人 Markdown 笔记本：**本地自动保存 + 一键同步到自己的 GitHub 仓库 + 临时密码门**。
基于原版「随手记存为.md」复刻，原有功能全部保留。

## 功能

- 📓 多本笔记：新建、搜索（标题 + 内容）、置顶、回收站（30 天可找回）
- ✍️ 实时预览 + Markdown 工具栏，自研渲染器（先转义再拼 HTML，防 XSS）
- 💾 本地自动保存：写入浏览器 localStorage，关掉再开还在
- ☁️ GitHub 云同步：配好 Token 后与仓库 `notes/` 目录**双向同步**，换设备也是同一份，每次同步都是一次 commit（自带版本历史）
- 📤 导出：单篇「下载 .md」、「备份全部」、「备份 JSON」原样恢复、「导入 .md」批量读回
- 🔑 临时密码门：打开网页需输入密码（sessionStorage，关掉标签页失效）
- 🖥 书签小窗、手机扫码打开、深浅色跟随系统、PWA 可安装

## 云端文件格式

每本笔记存为 `notes/<标题>-<id>.md`，首行是一条不可见的 HTML 注释记录 id/时间/标题，用于双向合并；导出的 .md 会自动剥掉这行。

## 部署

GitHub Pages，访问 <https://httcup.github.io/mymd/>

## 使用

1. 打开网页输入密码进入
2. 点 ⚙️ 填入 Fine-grained PAT（只授权本仓库 + `Contents: Read and write`），Token 仅存本机
3. 之后点 ☁️ 立即同步，或等自动同步（保存后 8 秒）

## 修改密码

浏览器控制台执行 `__genHash("新密码")`，把输出替换 `config.js` 里的 `passwordHash` 后提交。
