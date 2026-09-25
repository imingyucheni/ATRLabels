import fs from "node:fs";
import { isLoggedIn } from "@/lib/auth";
import { backupPath } from "@/lib/backup";

/** 下载备份（只有管理员） */
export async function GET(_: Request, { params }: { params: Promise<{ name: string }> }) {
  if (!(await isLoggedIn())) return new Response("Unauthorized", { status: 401 });
  const { name } = await params;
  try {
    const p = backupPath(decodeURIComponent(name));
    return new Response(new Uint8Array(fs.readFileSync(p)), {
      headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${decodeURIComponent(name)}"` },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
