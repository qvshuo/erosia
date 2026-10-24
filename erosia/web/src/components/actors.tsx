import { useEffect, useState } from "react";
import { ArrowLeft, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { api, categories } from "@/lib/api";
import type { LibraryActor, Work } from "@/lib/types";
import {
  Empty,
  SummaryHeader,
  WorkTitle,
  Pagination,
  SearchInput,
  Select,
  Status,
  useDebounce,
  rowNavigation,
} from "./shared";

interface Props {
  revision: string;
  busy: boolean;
  name?: string;
  works: Work[];
  refresh: () => Promise<void>;
  run: (fn: () => Promise<void>) => void;
  navigate: (path: string) => void;
}
export function Actors({
  revision,
  busy,
  name,
  works,
  refresh,
  run,
  navigate,
}: Props) {
  const [query, setQuery] = useState("");
  const search = useDebounce(query);
  const [filter, setFilter] = useState("all");
  const [actors, setActors] = useState<LibraryActor[]>([]);
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (name !== undefined) return;
    const controller = new AbortController();
    run(async () => {
      const rows = await api<LibraryActor[]>(
        `actors/library?query=${encodeURIComponent(search)}`,
        "GET",
        undefined,
        controller.signal,
      );
      if (!controller.signal.aborted) setActors(rows);
    });
    return () => controller.abort();
  }, [name, search, revision, run]);
  const rows = actors.filter(
    (a) => filter === "all" || a.portrait_status === filter,
  );
  const pages = Math.max(1, Math.ceil(rows.length / 100)),
    current = Math.min(page, pages);
  async function portraits(actor?: LibraryActor) {
    setPending(true);
    try {
      if (!actor) return;
      const result = await api<{
        portraits: { status: string; error?: string }[];
      }>(`actors/${encodeURIComponent(actor.name)}/portrait`, "POST", {});
      const error = result.portraits.find(
        (item) => item.status === "error" || item.status === "not_found",
      );
      if (error) throw new Error(error.error || "未找到头像，保留旧图");
      await refresh();
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <div hidden={name !== undefined} className="space-y-5">
        <SummaryHeader count={actors.length} unit="位演员" />
        <Card className="gap-0 py-0">
          <div className="flex flex-wrap gap-3 p-4">
            <SearchInput
              label="搜索演员"
              value={query}
              onChange={(v) => {
                setQuery(v);
                setPage(1);
              }}
            />
            <Select
              label="筛选头像"
              value={filter}
              onChange={(v) => {
                setFilter(v);
                setPage(1);
              }}
              options={{
                all: "全部状态",
                missing: "缺少头像",
                ready: "已有头像",
              }}
            />
          </div>
          <Table className="[&_th:first-child]:pl-4 [&_td:first-child]:pl-4 [&_th:last-child]:pr-4 [&_td:last-child]:pr-4">
            <TableHeader>
              <TableRow>
                {["头像", "演员", "作品数"].map((v) => (
                  <TableHead
                    key={v}
                    className={
                      v === "头像" ? "w-24" : v === "作品数" ? "w-24" : ""
                    }
                  >
                    {v}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice((current - 1) * 100, current * 100).map((a) => (
                <TableRow
                  key={a.name}
                  {...rowNavigation(() =>
                    navigate(`actors/${encodeURIComponent(a.name)}`),
                  )}
                  aria-label={`查看演员 ${a.name}`}
                >
                  <TableCell>
                    {a.portrait ? (
                      <img
                        className="size-12 rounded-md object-cover"
                        src={portraitURL(a)}
                        alt={a.name}
                        loading="lazy"
                      />
                    ) : (
                      <span
                        className="flex size-12 items-center justify-center rounded-md bg-muted text-muted-foreground"
                        aria-label="缺少头像"
                      >
                        <UserRound className="size-5" />
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="truncate font-medium" title={a.name}>
                    {a.name}
                    {a.status === "ambiguous" && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        同名待确认
                      </p>
                    )}
                  </TableCell>
                  <TableCell>{a.count}</TableCell>
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
        </Card>
      </div>
      {name !== undefined && (
        <ActorDetail
          key={name}
          revision={revision}
          name={name}
          works={works}
          run={run}
          navigate={navigate}
          disabled={busy || pending}
          portraits={portraits}
        />
      )}
    </>
  );
}
function portraitURL(actor: LibraryActor) {
  return `/api/actors/${encodeURIComponent(actor.portrait_name)}/portrait?v=${actor.portrait_version ?? ""}`;
}
function ActorDetail({
  revision,
  name,
  works,
  run,
  navigate,
  disabled,
  portraits,
}: {
  revision: string;
  name: string;
  works: Work[];
  run: Props["run"];
  navigate: Props["navigate"];
  disabled: boolean;
  portraits: (actor: LibraryActor) => Promise<void>;
}) {
  const [actor, setActor] = useState<LibraryActor | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const controller = new AbortController();
    run(async () => {
      const rows = await api<LibraryActor[]>(
        `actors/library?query=${encodeURIComponent(name)}`,
        "GET",
        undefined,
        controller.signal,
      );
      const found = rows.find((a) => a.name === name);
      if (!controller.signal.aborted) {
        setActor(found ?? null);
        setLoaded(true);
      }
    });
    return () => controller.abort();
  }, [name, works, revision, run]);
  const rows = works.filter(
    (w) =>
      actor?.codes.includes(w.code) &&
      `${w.code} ${w.path} ${w.title ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(rows.length / 100)),
    current = Math.min(page, pages);
  return (
    <div className="space-y-5">
      <Button variant="ghost" onClick={() => navigate("actors")}>
        <ArrowLeft />
        返回
      </Button>
      {!actor ? (
        <Empty>{loaded ? "演员已不在列表中" : "正在读取…"}</Empty>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">{actor.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {actor.count} 部作品
              </p>
            </div>
            <Button
              variant="outline"
              disabled={
                disabled || !actor.codes.length || !actor.portrait_eligible
              }
              onClick={() => run(() => portraits(actor))}
            >
              {actor.portrait ? "更新头像" : "获取头像"}
            </Button>
          </div>
          <div className="grid items-start gap-5 sm:grid-cols-[160px_1fr]">
            <Card>
              <CardContent>
                {actor.portrait ? (
                  <img
                    className="mx-auto max-h-64 w-full rounded-md object-contain"
                    src={portraitURL(actor)}
                    alt={actor.name}
                  />
                ) : (
                  <Empty>缺少头像</Empty>
                )}
                {actor.actors.some((value) => value !== actor.name) && (
                  <p className="mt-3 break-words text-sm text-muted-foreground">
                    作品署名：{actor.actors.join("、")}
                  </p>
                )}
                {actor.status === "ambiguous" && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    同名待确认
                  </p>
                )}
              </CardContent>
            </Card>
            <Card className="min-w-0 gap-0 py-0">
              <div className="p-4">
                <SearchInput
                  value={query}
                  onChange={(v) => {
                    setQuery(v);
                    setPage(1);
                  }}
                />
              </div>
              <Table className="[&_th:first-child]:pl-4 [&_td:first-child]:pl-4">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">作品</TableHead>
                    <TableHead>标题</TableHead>
                    <TableHead className="w-20">分类</TableHead>
                    <TableHead className="w-24">状态</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows
                    .slice((current - 1) * 100, current * 100)
                    .map((work) => (
                      <TableRow
                        key={work.path}
                        {...rowNavigation(() =>
                          navigate(
                            `library/work/${encodeURIComponent(work.path)}`,
                          ),
                        )}
                        aria-label={`查看 ${work.code}`}
                      >
                        <TableCell className="font-medium">
                          {work.code}
                        </TableCell>
                        <TableCell>
                          <WorkTitle title={work.title} />
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
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
