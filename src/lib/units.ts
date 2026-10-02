/**
 * 包裹单位：页面上尺寸（in / cm）和重量（oz / lb / g / kg）分开选；
 * 服务商只认三种组合（lb/in、kg/cm、g/cm），提交前换算成最接近的那一种。
 */
import type { UnitSystem } from "./shipbest/types";

export type DimUnit = "in" | "cm";
export type WeightUnit = "oz" | "lb" | "g" | "kg";
export const DIM_UNITS: DimUnit[] = ["in", "cm"];
export const WEIGHT_UNITS: WeightUnit[] = ["oz", "lb", "g", "kg"];

const LB = 453.59237; // 克
const GRAMS: Record<WeightUnit, number> = { oz: LB / 16, lb: LB, g: 1, kg: 1000 };

/** 老的三种组合 → 页面上的两个单位 */
export function unitsOf(sys: UnitSystem): { dim: DimUnit; weight: WeightUnit } {
  return sys === 3 ? { dim: "in", weight: "lb" } : sys === 2 ? { dim: "cm", weight: "kg" } : { dim: "cm", weight: "g" };
}

/** 换算成服务商认的组合：英寸配磅；厘米配克或公斤（磅、盎司换成公斤） */
export function toSystem(dim: DimUnit, weightUnit: WeightUnit, weight: number): { system: UnitSystem; weight: number } {
  const round = (n: number) => Math.round(n * 10000) / 10000;
  if (dim === "in") return { system: 3, weight: weightUnit === "lb" ? weight : round((weight * GRAMS[weightUnit]) / LB) };
  if (weightUnit === "g") return { system: 1, weight };
  return { system: 2, weight: weightUnit === "kg" ? weight : round((weight * GRAMS[weightUnit]) / 1000) };
}

export const isDimUnit = (v: unknown): v is DimUnit => v === "in" || v === "cm";
export const isWeightUnit = (v: unknown): v is WeightUnit => WEIGHT_UNITS.includes(v as WeightUnit);
