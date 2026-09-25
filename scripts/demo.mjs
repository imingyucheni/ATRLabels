#!/usr/bin/env node
/**
 * 一键启动演示环境（Windows / macOS / Linux 通用）：
 *   npm run demo
 * 使用模拟接口，不会真实下单扣费。数据保存在 ./data-demo，删除该目录即可重置。
 */
import { spawnSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";

const env = {
  ...process.env,
  SHIPBEST_MOCK: "1",
  DEMO_SEED: "1",
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "admin1234",
  SESSION_SECRET: process.env.SESSION_SECRET || "demo-session-secret-please-change",
  DATA_DIR: process.env.DATA_DIR || "./data-demo",
  COOKIE_SECURE: "0",
  PORT: process.env.PORT || "3000",
};
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

if (!existsSync(".next/BUILD_ID") || process.argv.includes("--build")) {
  console.log("首次运行，正在构建…");
  const r = spawnSync(npx, ["next", "build"], { stdio: "inherit", env, shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

console.log(`
==============================================
  演示环境已启动（模拟接口，不会真实下单）
  后台：   http://localhost:${env.PORT}/          密码：${env.ADMIN_PASSWORD}
  客户端： http://localhost:${env.PORT}/portal
           demo@example.com / demo1234     （预付，余额 200）
           monthly@example.com / demo1234  （月结，信用额度 500，加价 8%）
  重置数据：删除 ${env.DATA_DIR} 目录后重新运行
==============================================
`);
spawn(npx, ["next", "start", "-p", env.PORT], { stdio: "inherit", env, shell: process.platform === "win32" });
