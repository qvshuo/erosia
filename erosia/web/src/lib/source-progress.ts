import type { WorkDetail } from "./types";
import { statuses } from "./api";

const phases: Record<string, string> = {
  request: "访问页面",
  response: "解析页面",
  source: "正在刮削",
  challenge: "处理访问验证",
  retry: "重试请求",
};
const outcomes: Record<string, string> = {
  not_found: "未找到匹配番号",
  unsupported: "不支持此番号类型",
};

const idle = {
  status: "missing",
  phase: "",
  message: "",
  elapsed: undefined,
  action: "刮削",
};

export function sourceProgress(
  detail: WorkDetail,
  source: string,
  now = Date.now(),
) {
  const process = detail.process;
  if (process?.type === "retry_incomplete") return idle;
  const active = process?.status === "running" || process?.status === "pending";
  const current = detail.variants?.find((item) => item.source === source);
  const stored = process?.result?.sources?.find(
    (item) => item.source === source,
  );
  const fresh =
    current?.fetched_at &&
    process?.created_at &&
    Date.parse(current.fetched_at) >= Date.parse(process.created_at) &&
    (active ||
      (!!process.finished_at &&
        Date.parse(current.fetched_at) <= Date.parse(process.finished_at)));
  const report =
    stored?.fetched_at &&
    process?.created_at &&
    (Date.parse(stored.fetched_at) < Date.parse(process.created_at) ||
      (!!process.finished_at &&
        Date.parse(stored.fetched_at) > Date.parse(process.finished_at)))
      ? undefined
      : stored;
  const result = process
    ? active
      ? fresh
        ? current
        : undefined
      : (report ?? (fresh ? current : undefined))
    : current;
  const events =
    process?.events?.filter((event) => event.source === source) ?? [];
  const started = events.find(
    (item) => item.stage === "source" && item.status === "running",
  );
  // Image download events do not prove that metadata was fetched in this task.
  const finished = events.findLast(
    (item) =>
      item.stage === "source" && !["running", "pending"].includes(item.status),
  );
  const event =
    finished ??
    (started
      ? events.at(-1)
      : events.findLast(
          (item) => item.stage === "wait" && item.message === "等待来源队列",
        ));
  const status =
    result?.status ??
    finished?.status ??
    (active && event
      ? event.stage === "wait"
        ? "pending"
        : event.status
      : "missing");
  if (!statuses[status]) return idle;
  let elapsed =
    result?.elapsed_seconds ??
    (started && (active || finished)
      ? ((finished ? Date.parse(finished.time) : now) -
          Date.parse(started.time)) /
        1000
      : undefined);
  let phase = "";
  let message = "";
  if (status === "found") {
    const metadata = result === current ? current?.metadata : undefined;
    const artwork = metadata?.artwork;
    const cover = artwork
      ? artwork.some((item) => item.role !== "sample")
      : result?.has_cover;
    const samples = artwork
      ? artwork.filter((item) => item.role === "sample").length
      : result?.sample_count;
    const plot =
      metadata && (typeof metadata.plot === "string" || metadata.plot === null)
        ? !!metadata.plot
        : result?.has_plot;
    const facts = [
      typeof cover === "boolean" ? (cover ? "有封面" : "无封面") : "",
      typeof samples === "number" && Number.isInteger(samples) && samples >= 0
        ? `${samples} 张剧照`
        : "",
      typeof plot === "boolean" ? (plot ? "有剧情" : "无剧情") : "",
    ].filter(Boolean);
    message = facts.join(" · ") || "上次刮削成功，但未保留该来源的详细结果";
  } else if (status === "pending" || status === "running") {
    phase =
      event?.stage === "wait" ? "等待来源" : (phases[event?.stage ?? ""] ?? "");
    message = event?.stage === "wait" ? event.message || "" : "";
  } else if (status !== "missing") {
    message = result?.message || outcomes[status] || "";
  }
  if (
    elapsed === undefined ||
    !Number.isFinite(elapsed) ||
    elapsed < 0 ||
    status === "missing"
  )
    elapsed = undefined;
  const action =
    status === "found"
      ? "重新刮削"
      : ["missing", "pending", "running"].includes(status)
        ? "刮削"
        : "重试";
  return { status, phase, message, elapsed, action };
}
