import { describe, expect, it } from "vitest";
import { createSign, generateKeyPairSync } from "node:crypto";
import { verifyEbayNotification, type EbaySettings } from "../src/lib/stores/ebay";

const s: EbaySettings = { enabled: true, env: "sandbox", clientId: "x", clientSecret: "y", ruName: "r", verificationToken: "t".repeat(40) };

function signed(body: string, kid: string, privateKey: import("node:crypto").KeyObject) {
  const signature = createSign("sha1").update(body).sign(privateKey).toString("base64");
  return Buffer.from(JSON.stringify({ alg: "ECDSA", kid, signature, digest: "SHA1" })).toString("base64");
}

describe("eBay 账户删除通知签名", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  // eBay 有时返回不带换行的 PEM
  const pem = (publicKey.export({ type: "spki", format: "pem" }) as string).replace(/\n/g, "");
  const body = JSON.stringify({ metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION" }, notification: { data: { userId: "u1" } } });

  it("签名正确才通过", async () => {
    const fetchKey = async () => pem;
    expect(await verifyEbayNotification(s, signed(body, "kid-ok", privateKey), body, fetchKey)).toBe(true);
    expect(await verifyEbayNotification(s, signed(body, "kid-ok", privateKey), body.replace("u1", "u2"), fetchKey)).toBe(false);
  });

  it("没有签名 / 格式不对 / 别人的私钥都拒绝", async () => {
    const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey;
    const fetchKey = async () => pem;
    expect(await verifyEbayNotification(s, null, body, fetchKey)).toBe(false);
    expect(await verifyEbayNotification(s, "not-base64-json", body, fetchKey)).toBe(false);
    expect(await verifyEbayNotification(s, signed(body, "kid-other", other), body, fetchKey)).toBe(false);
    expect(await verifyEbayNotification(s, signed(body, "../evil", privateKey), body, fetchKey)).toBe(false);
  });
});
