// ===== MYMD 配置 =====
// 部署前请修改以下配置

// 仓库信息
const CONFIG = {
  owner: "httcup",          // 你的 GitHub 用户名
  repo: "mymd",             // 仓库名（全小写，与 Pages 路径一致）
  branch: "main",           // 分支
  notesDir: "notes",        // 笔记存放目录

  // 打开网页的临时密码（存的是 SHA-256 哈希，不是明文）
  // 当前密码: 四个空格 "    "
  // 修改方法: 浏览器控制台执行 __genHash("你的新密码")，把输出替换到这里
  passwordHash: "1a0f564ddc6039457b2fb26b3d6a316c15eba20a886449847c3210c35821a693"
};
