export async function api<T>(
  path: string,
  method = "GET",
  data?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method,
    signal,
    headers:
      data === undefined ? undefined : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error(`服务暂不可用（${response.status}）`);
  }
  if (!response.ok) {
    const detail = (value as { detail?: unknown }).detail;
    throw new Error(
      typeof detail === "string"
        ? (errors[detail] ?? detail)
        : "填写有误，请检查设置。",
    );
  }
  return value as T;
}
const errors: Record<string, string> = {
  "cannot change configuration while metadata is being edited":
    "保存完成后可修改设置。",
  "cannot create tasks while metadata is being edited":
    "保存完成后可创建任务。",
  "crop preview required before saving": "请先预览裁剪结果。",
  "cannot scan while a task is active": "任务结束后可扫描作品。",
  "task overlaps an active write task": "所选作品已有任务。",
  "no eligible works or requested directory is invalid/conflicting":
    "请选择名称正确的作品。",
  "explicit work ID or URL requires one key and a source":
    "请选择一部作品和一个数据源。",
  "cannot retry active task": "任务尚未结束。",
  "task contains no failed items": "没有可重试的失败项。",
  "directory is outside the available mounts": "请选择可访问的文件夹。",
  "configure media and metadata directories first":
    "请先设置作品目录和元数据目录。",
  "configuration change in progress": "正在更新设置，请稍后。",
  "filesystem access failed": "无法访问元数据目录。",
  "source image changed; preview again": "原图已更新，请重新预览。",
  "directory does not exist": "文件夹不存在。",
  "not found": "记录不存在。",
  "work not found": "作品已不在作品库中。",
};
export const sources: Record<string, string> = {
  dmm: "DMM",
  javdb: "JavDB",
  javbus: "JavBus",
  fc2: "FC2 官方",
  avsox: "AVSOX",
  airav: "AirAV",
  "1pondo": "一本道",
  caribbeancom: "加勒比",
  heyzo: "HEYZO",
  avbase: "AVbase",
};
export const categories: Record<string, string> = {
  censored: "有码",
  uncensored: "无码",
  fc2: "FC2",
  unknown: "未分类",
};
export const statuses: Record<string, string> = {
  pending: "等待中",
  partial: "部分完成",
  missing: "尚未刮削",
  cooldown: "冷却中",
  rate_limited: "来源限流",
  timeout: "来源超时",
  running: "进行中",
  scraped: "已完成",
  translation_partial: "翻译未完成",
  failed: "刮削失败",
  success: "已完成",
  finished: "已结束",
  invalid_key: "名称异常",
  conflict: "番号重复",
  cancelled: "已取消",
  skipped: "已跳过",
  found: "已刮削",
  not_found: "未找到",
  login_required: "需要登录",
  region_blocked: "地区限制",
  ip_blocked: "访问受限",
  blocked: "访问受限",
  network_error: "网络错误",
  parse_error: "解析失败",
  identity_mismatch: "番号不符",
  unsupported: "不支持",
};
export const stages: Record<string, string> = {
  source: "数据源",
  challenge: "访问助手",
  translation: "翻译",
  metadata: "保存元数据",
  images: "下载图片",
  portraits: "演员头像",
  crop: "裁剪封面",
  retry: "重试",
  finished: "完成",
  wait: "访问间隔",
  request: "访问",
  response: "响应",
  metadata_found: "解析元数据",
};
export const active = (value: { status: string }) =>
  ["pending", "running"].includes(value.status);
export const valid = (value: { status: string }) =>
  !["invalid_key", "conflict"].includes(value.status);
export function formatDate(value: string, progress = false): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = progress
    ? `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`
    : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  return `${day} ${date.toLocaleTimeString("zh-CN", { hour12: false })}`;
}
