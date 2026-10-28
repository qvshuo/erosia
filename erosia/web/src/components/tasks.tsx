import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { errorText } from "@/lib/messages";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  api,
  active,
  categories,
  formatDate,
  sources,
  stages,
} from "@/lib/api";
import type {
  ProgressEvent,
  Report,
  Task,
  TaskDetail,
  Work,
} from "@/lib/types";
import {
  Empty,
  WorkTitle,
  Pagination,
  SearchInput,
  Select,
  Status,
  useDebounce,
  rowNavigation,
  type Confirm,
} from "./shared";

const portraitOutcomes: Record<string, string> = {
  saved: "头像已保存",
  error: "头像获取失败",
  not_found: "未找到头像",
};

function TaskSummary({ task }: { task: Task }) {
  const counts = [
    `总计 ${task.total}`,
    `成功 ${task.success}`,
    `跳过 ${task.skipped}`,
    `失败 ${task.failed}`,
    ...(task.partial ? [`待补全 ${task.partial}`] : []),
  ];
  return (
    <span className="inline-flex flex-wrap gap-x-1 text-sm text-muted-foreground tabular-nums">
      {counts.map((count, index) => (
        <span key={count} className="whitespace-nowrap">
          {index > 0 && "· "}{count}
        </span>
      ))}
    </span>
  );
}

export function Process({
  events,
  running,
}: {
  events: ProgressEvent[];
  running?: boolean;
}) {
  const event = events.findLast(
    (item) => item.stage in stages || item.stage === "finished",
  );
  if (!event || !running) return null;
  const label =
    event.stage === "portraits" && event.status !== "running"
      ? portraitOutcomes[event.status]
      : stages[event.stage];
  if (!label) return null;
  return <p className="text-sm text-muted-foreground">{label}</p>;
}

export function Diagnostics({ report, title, active = false, taskRecord = false }: {
  report: Report | null | undefined;
  title: string;
  active?: boolean;
  taskRecord?: boolean;
}) {
  if (!report) return null;
  const labels: Record<string, string> = { metadata: "元数据", translation: "翻译", images: "图片", portraits: "头像" };
  const incomplete = (report.incomplete_stages ?? []).filter((stage) => !active || report.stages?.[stage] !== "pending");
  const notices = [
    report.error ? errorText(report.error) : "",
    ...(taskRecord ? report.warnings ?? [] : []).filter((warning) =>
      !warning.includes("used webpage fallback") && !warning.includes("missing plot") && !warning.includes("missing artwork") &&
      !report.sources?.some((source) => source.status !== "found" && warning.startsWith(`${source.source}:`)))
      .map((warning) => errorText(warning)),
    ...(report.translation_errors ?? []).map((item) => `翻译：${errorText(item.error)}`),
    ...(report.images ?? []).filter((item) => item.status === "error")
      .map((item) => `图片：${errorText(item.message ?? item.error)}`),
    ...(report.portraits ?? []).filter((item) => item.status === "error")
      .map((item) => `头像：${item.name} · ${errorText(item.error)}`),
    incomplete.length ? `未完成：${incomplete.map((stage) => labels[stage] ?? stage).join("、")}` :
      report.partial && !active ? "部分阶段未完成" : "",
  ].filter(Boolean);
  const missingPortraits = taskRecord ? (report.portraits ?? []).filter((item) => item.status === "not_found").map((item) => item.name) : [];
  const preservedNames = taskRecord ? (report.actor_issues ?? []).filter((issue) => !(report.portraits ?? []).some((portrait) => portrait.name === issue.name && portrait.status === "error")).map((issue) => issue.name) : [];
  if (!notices.length && !missingPortraits.length && !preservedNames.length) return null;
  return (
    <Alert role="status" className={notices.length ? "border-amber-500/20 bg-amber-500/5" : "bg-muted/20"}>
      <AlertTitle>{notices.length ? title : "处理结果"}</AlertTitle>
      <AlertDescription>
        {taskRecord && <p>记录当次结果，后续修复不改写</p>}
        {[...new Set(notices)].map((notice) => <p key={notice}>{notice}</p>)}
        {missingPortraits.length > 0 && <p>未匹配头像：{[...new Set(missingPortraits)].join("、")}</p>}
        {preservedNames.length > 0 && <p>别名有歧义，已保留署名：{[...new Set(preservedNames)].join("、")}</p>}
      </AlertDescription>
    </Alert>
  );
}
export function Tasks({
  tick,
  tasks,
  id,
  works,
  refresh,
  run,
  navigate,
  confirm,
}: {
  tick: number;
  tasks: Task[];
  id?: string;
  works: Work[];
  refresh: () => Promise<void>;
  run: (fn: () => Promise<void>) => void;
  navigate: (path: string) => void;
  confirm: Confirm;
}) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [query, setQuery] = useState("");
  const search = useDebounce(query);
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    run(async () => {
      try {
        const value = await api<TaskDetail>(`tasks/${id}?page=${page}&page_size=${pageSize}&status=${filter}&query=${encodeURIComponent(search)}`, "GET", undefined, controller.signal);
        if (!controller.signal.aborted) { setDetail(value); setLoadFailed(false); }
      } catch (error) {
        if (!controller.signal.aborted) setLoadFailed(true);
        throw error;
      }
    });
    return () => controller.abort();
  }, [id, page, pageSize, filter, search, tick, run]);
  async function mutate(task: Task, action: "retry" | "cancel" | "delete") {
    if (action === "delete" && !(await confirm("删除记录", "已有元数据保留")))
      return;
    setPending(true);
    try {
      await api(
        `tasks/${task.id}${action === "delete" ? "" : `/${action}`}`,
        action === "delete" ? "DELETE" : "POST",
      );
      await refresh();
    } finally {
      setPending(false);
    }
  }
  const workByCode = useMemo(
    () => new Map(works.map((work) => [work.code, work])),
    [works],
  );
  function action(task: Task) {
    return active(task) ? (
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => run(() => mutate(task, "cancel"))}
      >
        取消
      </Button>
    ) : task.failed || task.partial || task.status === "cancelled" ? (
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => run(() => mutate(task, "retry"))}
      >
        重试
      </Button>
    ) : null;
  }
  if (id)
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate("tasks")}>
          <ArrowLeft />
          返回
        </Button>
        {!detail || detail.id !== id ? (
          <Empty>{loadFailed ? "任务读取失败，请重新进入" : "正在读取…"}</Empty>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-semibold">#{detail.sequence}</h2>
                <Status status={detail.status} />
              </div>
              {active(detail) && action(detail)}
            </div>
            <TaskSummary task={detail} />
            {pending && <p role="status" className="text-sm text-muted-foreground">正在更新任务记录…</p>}
            <div className="flex flex-wrap gap-3">
              <SearchInput
                value={query}
                onChange={(value) => {
                  setQuery(value);
                  setPage(1);
                }}
              />
              <Select
                label="筛选结果"
                value={filter}
                onChange={(value) => {
                  setFilter(value);
                  setPage(1);
                }}
                options={{
                  all: "全部结果",
                  failed: "失败",
                  partial: "部分完成",
                  success: "已完成",
                  running: "进行中",
                  pending: "等待中",
                  cancelled: "已取消",
                }}
              />
            </div>
            {detail.error && (
              <p role="alert" className="text-sm text-destructive">
                {errorText(detail.error)}
              </p>
            )}
            <div className="overflow-hidden rounded-lg border">
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28 pl-4">作品</TableHead>
                    <TableHead className="w-[42%]">标题</TableHead>
                    <TableHead className="w-[22%]">演员</TableHead>
                    <TableHead className="w-20">分类</TableHead>
                    <TableHead className="w-24">状态</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.items.map((item) => {
                    const work = workByCode.get(item.code);
                    return (
                      <TableRow
                        key={item.code}
                        aria-label={`查看 ${item.code}`}
                        {...(work
                          ? rowNavigation(() =>
                              navigate(
                                `library/work/${encodeURIComponent(work.path)}/${detail.id}`,
                              ),
                            )
                          : {})}
                      >
                        <TableCell className="pl-4 font-medium">
                          {item.code}
                        </TableCell>
                        <TableCell>
                          <WorkTitle title={work?.title} />
                        </TableCell>
                        <TableCell
                          className="truncate"
                          title={work?.actors?.join("、")}
                        >
                          {work?.actors?.join("、") || "—"}
                        </TableCell>
                        <TableCell>
                          {work ? categories[work.category] : "—"}
                        </TableCell>
                        <TableCell>
                          <Status status={item.status} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {!detail.items.length && <Empty>{search || filter !== "all" ? "没有匹配的任务项" : "暂无任务项"}</Empty>}
            </div>
            <Pagination
              page={detail.page}
              pages={detail.pages}
              total={detail.matched}
              onChange={setPage}
              pageSize={pageSize}
              onPageSizeChange={setPageSize}
            />
          </>
        )}
      </div>
    );
  const rows = tasks.filter(
    (task) =>
      (filter === "all" || task.status === filter) &&
      `${task.sequence} ${formatDate(task.created_at)}`.includes(query),
  );
  const pages = Math.max(1, Math.ceil(rows.length / pageSize)),
    current = Math.min(page, pages);
  return (
    <div className="space-y-4">
      {pending && <p role="status" className="text-sm text-muted-foreground">正在更新任务记录…</p>}
      <div className="overflow-hidden rounded-lg border">
        <div className="flex flex-wrap gap-3 border-b p-4">
          <SearchInput
            label="搜索任务"
            value={query}
            onChange={(value) => {
              setQuery(value);
              setPage(1);
            }}
          />
          <Select
            label="筛选任务"
            value={filter}
            onChange={(value) => {
              setFilter(value);
              setPage(1);
            }}
            options={{
              all: "全部任务",
              running: "进行中",
              pending: "等待中",
              finished: "已结束",
              cancelled: "已取消",
            }}
          />
        </div>
        <Table className="min-w-[840px] [&_th:first-child]:pl-4 [&_td:first-child]:pl-4">
          <TableHeader>
            <TableRow>
              {["任务", "时间", "统计", "状态", ""].map((label, index) => (
                <TableHead
                  key={index}
                  className={["w-20", "w-52", "w-80", "w-24", "w-32"][index]}
                >
                  {label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice((current - 1) * pageSize, current * pageSize).map((task) => (
              <TableRow
                key={task.id}
                {...rowNavigation(() => navigate(`tasks/${task.id}`))}
                aria-label={`查看任务 #${task.sequence}`}
              >
                <TableCell>
                  #{task.sequence}
                  {task.params?.source_id && (
                    <span className="ml-2 text-sm text-muted-foreground">
                      {sources[task.params.source_id]}
                    </span>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm">
                  {formatDate(task.created_at)}
                </TableCell>
                <TableCell>
                  <TaskSummary task={task} />
                </TableCell>
                <TableCell>
                  <Status status={task.status} />
                </TableCell>
                <TableCell onClick={(event) => event.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    {action(task)}
                    <Button
                      size="sm"
                      variant="destructive-ghost"
                      disabled={pending || active(task)}
                      onClick={() => run(() => mutate(task, "delete"))}
                    >
                      删除
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!rows.length && <Empty>{query || filter !== "all" ? "没有匹配的任务" : "暂无记录"}</Empty>}
        <Pagination
          page={current}
          pages={pages}
          total={rows.length}
          onChange={setPage}
          pageSize={pageSize}
          onPageSizeChange={setPageSize}
        />
      </div>
    </div>
  );
}
