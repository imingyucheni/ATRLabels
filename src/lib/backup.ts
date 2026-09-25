/**
 * 数据备份与恢复（正式数据）：
 * - 每天凌晨 3 点服务器自动备份（atrlabels-日期.db + files-日期.tgz，安装脚本里的定时任务）
 * - 后台“数据备份”可以随时手动备份；清除测试数据、恢复备份之前也会自动备份
 * - 每个备份包括数据库和面单 / 充值凭证等文件，恢复时一起恢复
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { closeLiveDb, liveDb, rootDir } from "./db";

export type BackupKind = "daily" | "manual" | "before-clear" | "before-restore";

export const BACKUP_KIND_LABEL: Record<BackupKind, string> = {
  daily: "每日自动",
  manual: "手动备份",
  "before-clear": "清除测试数据前",
  "before-restore": "恢复备份前",
};

const FILE_DIRS = ["labels", "topup", "samples", "assets"];
const NAME_RE = /^(atrlabels-\d{4}-\d{2}-\d{2}|manual-[\w-]+|before-clear-[\w-]+|before-restore-[\w-]+)\.db$/;

export const backupDir = () => path.join(rootDir(), "backups");

function kindOf(name: string): BackupKind {
  if (name.startsWith("manual-")) return "manual";
  if (name.startsWith("before-clear-")) return "before-clear";
  if (name.startsWith("before-restore-")) return "before-restore";
  return "daily";
}

/** 每日备份的文件包：files-日期.tgz；其他备份：同名 .files 文件夹 */
function filesOf(name: string): { type: "dir" | "tgz"; path: string } | null {
  const base = name.replace(/\.db$/, "");
  const dir = path.join(backupDir(), `${base}.files`);
  if (fs.existsSync(dir)) return { type: "dir", path: dir };
  const m = name.match(/^atrlabels-(\d{4}-\d{2}-\d{2})\.db$/);
  const tgz = m ? path.join(backupDir(), `files-${m[1]}.tgz`) : "";
  return tgz && fs.existsSync(tgz) ? { type: "tgz", path: tgz } : null;
}

export interface BackupInfo {
  name: string;
  kind: BackupKind;
  size: number;
  time: string;
  hasFiles: boolean;
}

export function listBackups(): BackupInfo[] {
  if (!fs.existsSync(backupDir())) return [];
  return fs
    .readdirSync(backupDir())
    .filter((f) => NAME_RE.test(f))
    .map((f) => {
      const st = fs.statSync(path.join(backupDir(), f));
      return { name: f, kind: kindOf(f), size: st.size, time: st.mtime.toISOString(), hasFiles: !!filesOf(f) };
    })
    .sort((a, b) => b.time.localeCompare(a.time));
}

export function isBackupName(name: string) {
  return NAME_RE.test(name) && !name.includes("/") && !name.includes("..");
}

export function backupPath(name: string) {
  if (!isBackupName(name)) throw new Error("备份文件名不正确");
  const p = path.join(backupDir(), name);
  if (!fs.existsSync(p)) throw new Error("备份不存在");
  return p;
}

/** 备份正式数据库和文件；返回备份文件名 */
export function createBackup(kind: Exclude<BackupKind, "daily">): string {
  fs.mkdirSync(backupDir(), { recursive: true });
  const name = `${kind}-${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
  const file = path.join(backupDir(), name);
  liveDb().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const filesDir = path.join(backupDir(), name.replace(/\.db$/, ".files"));
  for (const d of FILE_DIRS) {
    const src = path.join(rootDir(), d);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(filesDir, d), { recursive: true });
  }
  return name;
}

/** 恢复备份：先把当前数据备份一次，再用备份替换数据库和文件 */
export function restoreBackup(name: string): { safety: string } {
  const src = backupPath(name);
  const files = filesOf(name);
  const safety = createBackup("before-restore");
  closeLiveDb();
  const live = path.join(rootDir(), "atrlabels.db");
  for (const f of [live, `${live}-wal`, `${live}-shm`]) fs.rmSync(f, { force: true });
  fs.copyFileSync(src, live);
  if (files?.type === "dir") {
    for (const d of FILE_DIRS) {
      const from = path.join(files.path, d);
      if (fs.existsSync(from)) fs.cpSync(from, path.join(rootDir(), d), { recursive: true });
    }
  } else if (files?.type === "tgz") {
    execFileSync("tar", ["-xzf", files.path, "-C", rootDir()], { timeout: 120_000 });
  }
  liveDb(); // 重新打开
  return { safety };
}

/** 删除手动 / 自动产生的备份（连同文件） */
export function deleteBackup(name: string) {
  const p = backupPath(name);
  fs.rmSync(p, { force: true });
  const files = filesOf(name);
  if (files?.type === "dir") fs.rmSync(files.path, { recursive: true, force: true });
}
