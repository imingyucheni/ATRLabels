import { describe, expect, it } from "vitest";
import { toSystem, unitsOf } from "@/lib/units";

describe("包裹单位换算", () => {
  it("英寸配磅：盎司 / 克 / 公斤换成磅", () => {
    expect(toSystem("in", "lb", 2)).toEqual({ system: 3, weight: 2 });
    expect(toSystem("in", "oz", 16)).toEqual({ system: 3, weight: 1 });
    expect(toSystem("in", "oz", 8)).toEqual({ system: 3, weight: 0.5 });
    expect(toSystem("in", "kg", 1)).toEqual({ system: 3, weight: 2.2046 });
    expect(toSystem("in", "g", 453.59237)).toEqual({ system: 3, weight: 1 });
  });
  it("厘米配克或公斤：磅 / 盎司换成公斤", () => {
    expect(toSystem("cm", "g", 500)).toEqual({ system: 1, weight: 500 });
    expect(toSystem("cm", "kg", 1.5)).toEqual({ system: 2, weight: 1.5 });
    expect(toSystem("cm", "lb", 1)).toEqual({ system: 2, weight: 0.4536 });
    expect(toSystem("cm", "oz", 16)).toEqual({ system: 2, weight: 0.4536 });
  });
  it("老的三种组合对应页面单位", () => {
    expect(unitsOf(3)).toEqual({ dim: "in", weight: "lb" });
    expect(unitsOf(2)).toEqual({ dim: "cm", weight: "kg" });
    expect(unitsOf(1)).toEqual({ dim: "cm", weight: "g" });
  });
});
