/**
 * 操作人记法（写进流水 created_by、充值申请 handled_by）：
 * - "admin" = 主管理员（升级前的老记录也是 admin，那时只有主管理员）
 * - "staff:<id>:<姓名>" = 员工（二级管理员），姓名记当时的，之后改名不影响老记录
 * - "customer" / "customer:…" = 客户自己，"system" = 系统自动
 */
export function actorOf(who: { role: "owner" | "staff"; id: number; name: string }): string {
  return who.role === "owner" ? "admin" : `staff:${who.id}:${who.name.replace(/:/g, " ")}`;
}

/** 显示用（中文；页面上再翻译） */
export function actorLabel(createdBy: string | null | undefined): string {
  if (!createdBy) return "-";
  if (createdBy === "admin") return "主管理员";
  if (createdBy.startsWith("staff:")) return createdBy.split(":").slice(2).join(":") || "管理员";
  if (createdBy === "system") return "系统";
  if (createdBy === "customer" || createdBy.startsWith("customer")) return "客户";
  return createdBy;
}
