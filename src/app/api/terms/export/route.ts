import { isLoggedIn } from "@/lib/auth";
import { localDate } from "@/lib/reports";
import { acceptanceDocument, acceptanceFilename, allAcceptances } from "@/lib/terms";
import { csvCell } from "@/lib/csv";
import { uniqueNames, zipStore } from "@/lib/zip";

/** 管理员：全部客户的签署存档打包下载（每份一个 HTML，另附一张签署清单 CSV） */
export async function GET() {
  if (!(await isLoggedIn())) return new Response("Unauthorized", { status: 401 });
  const list = allAcceptances();
  if (!list.length) return new Response("还没有客户签署过服务条款", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const names = uniqueNames(list.map(acceptanceFilename));
  const enc = new TextEncoder();
  const csv =
    "﻿" +
    [["文件", "客户", "协议版本", "签署人", "职位", "签署时间(UTC)", "IP", "原文校验码SHA-256"], ...list.map((a, i) => [names[i], a.party?.customer, a.version, a.signer, a.signerTitle, a.acceptedAt, a.ip, a.sha256])]
      .map((r) => r.map(csvCell).join(","))
      .join("\r\n");
  const zip = zipStore([{ name: "签署清单.csv", data: enc.encode(csv) }, ...list.map((a, i) => ({ name: names[i], data: enc.encode(acceptanceDocument(a)) }))]);
  const fname = `服务协议签署存档-${localDate()}.zip`;
  return new Response(new Uint8Array(zip), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="agreements-${localDate()}.zip"; filename*=UTF-8''${encodeURIComponent(fname)}` },
  });
}
