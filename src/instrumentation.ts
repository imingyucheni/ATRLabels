/** 服务启动时执行一次：开启后台定时任务（自动取回已扣款订单的面单） */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startPendingSweeper } = await import("./lib/service");
  startPendingSweeper();
}
