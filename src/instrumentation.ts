/** 服务启动时执行一次：开启后台定时任务（自动取回已扣款订单的面单） */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // 没设时区时按美西时间（“今日 / 本月”统计、对账单日期都按美西日期；正式服务器 systemd 里已设 TZ）
  if (!process.env.TZ) process.env.TZ = "America/Los_Angeles";
  const { startPendingSweeper } = await import("./lib/service");
  startPendingSweeper();
}
