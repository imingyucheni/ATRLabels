import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildHeaders, buildSignString, sign } from "@/lib/shipbest/sign";

describe("ShipBest 签名", () => {
  const input = {
    apiId: "UI14250619120001",
    accessToken: "9c4d1e0822f64d4485babed6dba8e9c5",
    url: "/api/order/getProducts",
    timestamp: "1692889556000",
    nonce: "14",
  };

  it("按 key 排序后用 & 拼接（与文档示例字符串一致）", () => {
    expect(buildSignString(input)).toBe(
      "accessToken=9c4d1e0822f64d4485babed6dba8e9c5&apiId=UI14250619120001&method=post&nonce=14&timestamp=1692889556000&url=/api/order/getProducts",
    );
  });

  it("使用 accessToken 作为密钥做 HmacSHA256，输出小写 hex", () => {
    const expected = createHmac("sha256", input.accessToken).update(buildSignString(input)).digest("hex");
    expect(sign(input)).toBe(expected);
    expect(sign(input)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("生成完整请求头", () => {
    const h = buildHeaders("id1", "tok1", "/api/order/detail", 1700000000000);
    expect(h.timestamp).toBe("1700000000000");
    expect(Number(h.nonce)).toBeGreaterThanOrEqual(10);
    expect(Number(h.nonce)).toBeLessThan(100);
    expect(h.sign).toBe(sign({ apiId: "id1", accessToken: "tok1", url: "/api/order/detail", timestamp: h.timestamp, nonce: h.nonce }));
  });
});
