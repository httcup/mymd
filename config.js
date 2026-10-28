// ===== MYMD 配置 =====
// 部署前请修改以下配置

// 仓库信息
const CONFIG = {
  owner: "httcup",          // 你的 GitHub 用户名
  repo: "MYMD",             // 仓库名
  branch: "main",           // 分支
  notesDir: "notes",        // 笔记存放目录

  // 打开网页的临时密码（存的是 SHA-256 哈希，不是明文）
  // 默认密码: mymd2026
  // 修改方法: 浏览器控制台执行 __genHash("你的新密码")，把输出替换到这里
  passwordHash: "fbff40522861ab45c9a3ebbeb509c019bf0bae19a3dea3721022751452967516"
};
