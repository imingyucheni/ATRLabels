import { describe, expect, it } from "vitest";
import { cleanChannelName, guessCarrier, publicChannel } from "@/lib/carriers";

describe("客户看到的渠道名称 / 物流商", () => {
  it("去掉仓库邮编后缀", () => {
    expect(cleanChannelName("GOFO-（91710）")).toBe("GOFO");
    expect(cleanChannelName("UniUni-（91710）")).toBe("UniUni");
    expect(cleanChannelName("USPS-(91710)")).toBe("USPS");
    expect(cleanChannelName("SwiftX-91710")).toBe("SwiftX");
    expect(cleanChannelName("YWE Air-91710")).toBe("YWE Air");
    expect(cleanChannelName("SPX-LAX")).toBe("SPX-LAX");
  });
  it("识别物流商", () => {
    expect(guessCarrier("USPS-（91710）")).toBe("usps");
    expect(guessCarrier("UniUni-（91710）")).toBe("uniuni");
    expect(guessCarrier("SPX-LAX")).toBe("spx");
    expect(guessCarrier("SpeedX Ground")).toBe("speedx");
    expect(guessCarrier("神秘渠道")).toBe("other");
  });
  it("后台设置的名称优先", () => {
    expect(publicChannel({ name: "SPX-LAX", displayName: "SPX Express", carrier: null })).toEqual({ name: "SPX Express", carrier: "spx" });
    expect(publicChannel({ name: "GOFO-（91710）", displayName: "", carrier: "speedx" })).toEqual({ name: "GOFO", carrier: "speedx" });
  });
});
