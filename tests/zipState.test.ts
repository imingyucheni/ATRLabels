import { describe, expect, it } from "vitest";
import { statesForZip, zipStateMismatch } from "../src/lib/zipState";

describe("邮编和州", () => {
  it("常见邮编对得上", () => {
    for (const [z, s] of [["91789", "CA"], ["91789-2810", "CA"], ["10001", "NY"], ["78701", "TX"], ["73301", "TX"], ["60601", "IL"], ["20001", "DC"], ["96799", "AS"], ["99501", "AK"], ["02108", "MA"], ["07030", "NJ"], ["33101", "FL"], ["89101", "NV"], ["84101", "UT"], ["97201", "OR"], ["98101", "WA"]])
      expect(zipStateMismatch(z, s), `${z} ${s}`).toBeNull();
  });
  it("对不上时给出应在的州", () => {
    expect(zipStateMismatch("91789", "NY")).toEqual(["CA"]);
    expect(zipStateMismatch("10001", "nj")).toEqual(["NY"]);
  });
  it("格式不对或没填州不判断", () => {
    expect(zipStateMismatch("abc", "CA")).toBeNull();
    expect(zipStateMismatch("91789", "")).toBeNull();
    expect(statesForZip("00000")).toBeNull();
  });
});
