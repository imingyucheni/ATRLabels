/** 批量任务状态（前后端共用，不能引用服务端模块） */
export type JobStatus = "quoting" | "ready" | "creating" | "labeling" | "done";

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  quoting: "报价中",
  ready: "待确认",
  creating: "下单中",
  labeling: "生成面单中",
  done: "已完成",
};
