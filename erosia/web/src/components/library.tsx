import { useDeferredValue, useMemo, useState } from "react";
import { ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { api, categories, valid } from "@/lib/api";
import type { Work } from "@/lib/types";
import {
  Empty,
  SummaryHeader,
  WorkTitle,
  Pagination,
  SearchInput,
  Select,
  Status,
  rowNavigation,
} from "./shared";

const groups: Record<string, string[]> = {
  todo: ["pending", "failed", "partial", "invalid_key", "conflict"],
  done: ["scraped"],
  running: ["running"],
};
export function Library({
  works,
  configured,
  busy,
  refresh,
  tasksChanged,
  run,
  navigate,
}: {
  works: Work[];
  configured: boolean;
  busy: boolean;
  refresh: () => Promise<void>;
  tasksChanged: () => Promise<void>;
  run: (fn: () => Promise<void>) => void;
  navigate: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const search = useDeferredValue(query.toLowerCase());
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState("fill_missing");
  const [pending, setPending] = useState(false);
  const [scanned, setScanned] = useState(false);
  const rows = useMemo(
    () =>
      works.filter(
        (work) =>
          `${work.code} ${work.path} ${work.title ?? ""} ${work.actors?.join(" ") ?? ""}`
            .toLowerCase()
            .includes(search) &&
          (filter === "all" || groups[filter]?.includes(work.status)),
      ),
    [works, search, filter],
  );
  const pages = Math.max(1, Math.ceil(rows.length / 100)),
    current = Math.min(page, pages);
  const visible = rows.slice((current - 1) * 100, current * 100);
  const chosen = works.filter((work) => selected.has(work.path) && valid(work));
  const eligible = visible.filter(valid);
  function toggle(paths: string[], checked: boolean) {
    setSelected((old) => {
      const next = new Set(old);
      paths.forEach((path) => (checked ? next.add(path) : next.delete(path)));
      return next;
    });
  }
  function perform(fn: () => Promise<void>) {
    run(async () => {
      setPending(true);
      try {
        await fn();
      } finally {
        setPending(false);
      }
    });
  }
  return (
    <div className="space-y-4">
      <SummaryHeader
        count={works.length}
        unit="部作品"
        suffix={chosen.length ? ` · 已选 ${chosen.length}` : ""}
      ></SummaryHeader>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          label="刮削模式"
          value={mode}
          onChange={setMode}
          disabled={busy || pending}
          options={{
            fill_missing: "补齐缺失",
            refresh: "重新刮削",
          }}
        />
        <Button
          disabled={busy || pending || !chosen.length}
          onClick={() =>
            perform(async () => {
              await api("tasks", "POST", {
                type: mode,
                codes: chosen.map((work) => work.code),
              });
              await tasksChanged();
              navigate("tasks");
            })
          }
        >
          刮削元数据
        </Button>
        <div className="ml-auto flex items-center gap-3">
          <span aria-live="polite" className="text-sm text-muted-foreground">
            {scanned ? "扫描完成" : ""}
          </span>
          <Button
            variant="outline"
            disabled={busy || pending || !configured}
            onClick={() =>
              perform(async () => {
                setScanned(false);
                await api("scan", "POST");
                await refresh();
                setScanned(true);
              })
            }
          >
            <ScanLine />
            扫描作品
          </Button>
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border">
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <SearchInput
            value={query}
            onChange={(value) => {
              setQuery(value);
              setPage(1);
            }}
          />
          <Select
            label="筛选状态"
            value={filter}
            onChange={(value) => {
              setFilter(value);
              setPage(1);
            }}
            options={{
              all: "全部状态",
              todo: "待处理",
              running: "进行中",
              done: "已完成",
            }}
          />
          {selected.size > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set())}
            >
              清除选择
            </Button>
          )}
        </div>
        <Table className="min-w-[760px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-12 pl-4">
                <Checkbox
                  aria-label="选择本页"
                  disabled={!eligible.length}
                  checked={
                    eligible.length > 0 &&
                    eligible.every((work) => selected.has(work.path))
                      ? true
                      : eligible.some((work) => selected.has(work.path))
                        ? "indeterminate"
                        : false
                  }
                  onCheckedChange={(checked) =>
                    toggle(
                      eligible.map((work) => work.path),
                      checked === true,
                    )
                  }
                />
              </TableHead>
              <TableHead className="w-28">作品</TableHead>
              <TableHead className="w-[42%]">标题</TableHead>
              <TableHead className="w-[22%]">演员</TableHead>
              <TableHead className="w-20">分类</TableHead>
              <TableHead className="w-24">状态</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((work) => (
              <TableRow
                key={work.path}
                {...rowNavigation(() =>
                  navigate(`library/work/${encodeURIComponent(work.path)}`),
                )}
                aria-label={`查看 ${work.code}`}
              >
                <TableCell className="pl-4">
                  <Checkbox
                    aria-label={`选择 ${work.code}`}
                    checked={selected.has(work.path) && valid(work)}
                    disabled={!valid(work)}
                    onCheckedChange={(checked) =>
                      toggle([work.path], checked === true)
                    }
                  />
                </TableCell>
                <TableCell className="font-medium">{work.code}</TableCell>
                <TableCell>
                  <WorkTitle title={work.title} />
                </TableCell>
                <TableCell className="truncate" title={work.actors?.join("、")}>
                  {work.actors?.join("、") || "—"}
                </TableCell>
                <TableCell>{categories[work.category]}</TableCell>
                <TableCell>
                  <Status status={work.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!rows.length && <Empty />}
        <Pagination
          page={current}
          pages={pages}
          total={rows.length}
          onChange={setPage}
        />
      </div>
    </div>
  );
}
