# MYMD

私人 Markdown 笔记应用：多篇笔记 + 密码门 + 保存在 GitHub 仓库。

## 特性

- 📝 多篇笔记，带列表页，明文 `.md` 存放在 `notes/` 目录
- 🔑 打开网页需输入临时密码（sessionStorage，关掉标签页失效）
- ☁️ 保存即 GitHub commit，自带版本历史，支持防抖自动保存
- 👁️ Markdown 实时预览（marked + DOMPurify）
- 🔒 Token 仅保存在本机浏览器 localStorage，不进代码仓库

## 部署（GitHub Pages）

1. 在 GitHub 新建公开仓库 `MYMD`，推送本目录代码
2. 仓库 Settings → Pages → Source 选 `main` 分支 `/ (root)`，Save
3. 访问 `https://<你的用户名>.github.io/MYMD/`

## 修改密码

浏览器控制台执行 `__genHash("新密码")`，把输出的哈希替换 `config.js` 里的 `passwordHash`，提交推送即可。

## 使用前

页面右上角 ⚙️ 设置里填入 Fine-grained PAT（仅授权本仓库 + Contents: Read and write），保存笔记用。

## ⚠️ 安全说明

仓库是公开的，密码只是网页端的门帘，**任何人仍可通过 GitHub API 直接读到笔记内容**。有真正隐私的内容请勿存入。
