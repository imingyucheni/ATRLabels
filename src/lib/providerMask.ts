/**
 * 服务商的全名（ShipBest、嘉谷万邑）只给主管理员看：
 * - 管理员：看简称 SB / GDE（开通渠道时要分得清是哪条线），看不到全名和服务商的渠道代码（JG-…、LP…），
 *   报错用和客户一样的说法（publicError 会去掉服务商名称和内部信息）；
 * - 客户、未登录的人：完全看不到服务商（渠道用对外名称，见 channelDisplay）。
 */
import { createHash } from "node:crypto";
import { stripProviderTag } from "./carriers";
import { publicError, publicQuoteError } from "./portal";

/** 管理员看到的渠道名：内部名称，服务商只留简称（“· SB”“· GDE”），不出现全名 */
export function maskedChannelName(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  return stripProviderTag(n) === n ? n : n.replace(/·\s*嘉谷\s*$/, "· GDE");
}

/** 渠道代码换成代号（同一个渠道每次都一样，页面上能对得上；看不出是哪家服务商的代码） */
export function maskedChannelCode(code: string): string {
  return "CH-" + createHash("sha256").update(`channel:${code}:${process.env.SESSION_SECRET ?? ""}`).digest("hex").slice(0, 6).toUpperCase();
}

/** 报错：和客户看到的一样（不带服务商名称、错误码、仓库等内部信息） */
export function maskedMessage(msg: string | null | undefined): string | undefined {
  return msg ? publicError(msg) : undefined;
}

/** 某个渠道报不出价的原因：和客户一样只说大类（地址未覆盖 / 超尺寸 / 不支持该重量…） */
export function maskedQuoteError(msg: string | null | undefined): string {
  return publicQuoteError(msg);
}

/** 渠道分组（客户详情 → 可用渠道）给管理员看的标题：只写简称 */
export const MASKED_GROUP_LABEL: Record<string, string> = { ShipBest: "SB", 嘉谷: "GDE", DHL: "DHL Express 国际" };
