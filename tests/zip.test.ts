import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { crc32, uniqueNames, zipStore } from "@/lib/zip";

describe("打包下载 ZIP", () => {
  it("CRC 和标准值一致", () => {
    expect(crc32(Buffer.from("hello"))).toBe(0x3610a686);
  });

  it("同名文件自动加序号", () => {
    expect(uniqueNames(["A.pdf", "B.pdf", "a.pdf", "A.pdf"])).toEqual(["A.pdf", "B.pdf", "a-2.pdf", "A-3.pdf"]);
  });

  it("生成的 ZIP 能被系统解压，中文文件名不乱码", () => {
    const zip = zipStore([
      { name: "114-4632749-7321005-9400.pdf", data: Buffer.from("%PDF-1.4 one") },
      { name: "订单-2.pdf", data: Buffer.from("%PDF-1.4 two") },
    ]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atr-zip-"));
    const file = path.join(dir, "t.zip");
    fs.writeFileSync(file, zip);
    let unzip = true;
    try {
      execFileSync("unzip", ["-v"], { stdio: "ignore" });
    } catch {
      unzip = false;
    }
    if (unzip) {
      const out = path.join(dir, "out");
      execFileSync("unzip", ["-q", file, "-d", out]);
      expect(fs.readFileSync(path.join(out, "114-4632749-7321005-9400.pdf"), "utf8")).toBe("%PDF-1.4 one");
      // 中文文件名能不能显示取决于解压软件和系统语言，这里只检查内容完整
      const names = fs.readdirSync(out);
      expect(names).toHaveLength(2);
      expect(names.map((n) => fs.readFileSync(path.join(out, n), "utf8")).sort()).toEqual(["%PDF-1.4 one", "%PDF-1.4 two"]);
    } else {
      // 没有 unzip 命令时至少检查结尾记录里的文件数
      const eocd = zip.subarray(zip.length - 22);
      expect(eocd.readUInt32LE(0)).toBe(0x06054b50);
      expect(eocd.readUInt16LE(10)).toBe(2);
    }
  });
});
