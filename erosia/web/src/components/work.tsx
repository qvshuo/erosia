import {
  Fragment,
  lazy,
  Suspense,
  useEffect,
  useEffectEvent,
  useState,
} from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, sources, formatDate } from "@/lib/api";
import {
  fields,
  metadataDraft,
  metadataForm,
  type Draft,
  type FieldKey,
} from "@/lib/metadata";
import type { ImageChoice, Variant, WorkDetail, Work as WorkRecord } from "@/lib/types";
import {
  Empty,
  Select,
  Status,
  StickyActions,
  type EditReporter,
} from "./shared";
import { Diagnostics, Process } from "./tasks";
import { sourceProgress } from "@/lib/source-progress";

const CropEditor = lazy(() => import("./crop-editor"));
type Editor = {
  detail: WorkDetail;
  draft: Draft;
  fieldSources: Record<string, string>;
  images: Record<string, ImageChoice>;
  imageSetSource?: string;
};
export function Work({
  path,
  taskId,
  revision,
  back,
  run,
  refresh,
  saved,
  reportEdit,
}: {
  path: string;
  taskId?: string;
  revision?: WorkRecord;
  back: () => void;
  run: (fn: () => Promise<void>) => void;
  refresh: () => Promise<void>;
  saved: (work: WorkDetail) => void;
  reportEdit: EditReporter;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [pending, setPending] = useState<"save" | "prepare" | null>(null);
  const [cropFile, setCropFile] = useState<string | null>(null);
  const [mode, setMode] = useState("fill_missing");
  const changed =
    !!editor &&
    (Object.keys(editor.fieldSources).length > 0 ||
      Object.keys(editor.images).length > 0 ||
      !!editor.imageSetSource ||
      JSON.stringify(editor.draft) !==
        JSON.stringify(metadataDraft(editor.detail)));
  function accept(detail: WorkDetail) {
    setEditor({
      detail,
      draft: metadataDraft(detail),
      fieldSources: {},
      images: {},
    });
  }
  const receive = useEffectEvent((detail: WorkDetail) => {
    if (!changed && !pending && !cropFile) accept(detail);
    else
      setEditor((current) =>
        current
          ? {
              ...current,
              detail: {
                ...current.detail,
                variants: detail.variants,
                process: detail.process,
                last_result: detail.last_result,
                status: detail.status,
                editable: detail.editable,
              },
            }
          : current,
      );
  });
  useEffect(() => {
    const controller = new AbortController();
    run(async () =>
      receive(
        await api<WorkDetail>(
          `works/detail?path=${encodeURIComponent(path)}${taskId ? `&task_id=${encodeURIComponent(taskId)}` : ""}`,
          "GET",
          undefined,
          controller.signal,
        ),
      ),
    );
    return () => controller.abort();
  }, [path, taskId, revision, run]);
  useEffect(() => {
    reportEdit({ dirty: changed, saving: !!pending });
    return () => reportEdit({ dirty: false, saving: false });
  }, [changed, pending, reportEdit]);
  if (!editor) return <Empty>正在读取作品…</Empty>;
  const { detail, draft } = editor;
  const base = `works/${encodeURIComponent(detail.code)}`;
  const updatedAt = detail.process?.events?.at(-1)?.time;
  const locked = !!pending || !detail.editable;
  const scrapeLocked =
    locked || ["pending", "running"].includes(detail.process?.status ?? "");
  const variants = detail.variants ?? [];
  const route = detail.route_sources ?? variants.map((v) => v.source);
  const artwork = (file: string) =>
    `/api/${base}/artwork?file=${encodeURIComponent(file)}&v=${detail.artwork_versions[file] ?? ""}`;
  function perform(
    fn: () => Promise<void>,
    action: "save" | "prepare" = "prepare",
  ) {
    run(async () => {
      setPending(action);
      try {
        await fn();
      } finally {
        setPending(null);
      }
    });
  }
  function sourceOf(key: string) {
    return (
      editor!.fieldSources[key] ??
      detail.selection?.field_sources?.[key] ??
      "unknown"
    );
  }
  async function chooseField(key: FieldKey, source: string) {
    if (source === "unknown") return;
    if (source === "custom") {
      setEditor((current) =>
        current
          ? {
              ...current,
              fieldSources: { ...current.fieldSources, [key]: "custom" },
            }
          : current,
      );
      return;
    }
    const variant = await api<Variant>(
      `${base}/variants/${source}/preview`,
      "POST",
      {},
    );
    const next = metadataDraft({ ...detail, metadata: variant.metadata });
    setEditor((current) =>
      current
        ? {
            ...current,
            draft: { ...current.draft, [key]: next[key] },
            fieldSources: { ...current.fieldSources, [key]: source },
            detail: {
              ...current.detail,
              variants: variants.map((v) =>
                v.source === source ? variant : v,
              ),
            },
          }
        : current,
    );
  }
  async function scrape(source?: string) {
    await api("tasks", "POST", {
      type: source ? "fetch_source" : mode,
      codes: [detail.code],
      ...(source ? { source_id: source } : {}),
    });
    await refresh();
  }
  async function save() {
    const result = await api<WorkDetail>(`${base}/metadata`, "PUT", {
        ...metadataForm(draft),
        field_sources: editor!.fieldSources,
        ...(editor!.imageSetSource
          ? { image_set_source: editor!.imageSetSource }
          : {}),
        image_choices: editor!.images,
      });
    accept(result);
    saved(result);
  }
  const imageFiles = Object.fromEntries(
    detail.artwork
      .map((file) => [file.match(/-(poster|fanart\d*)\.[^.]+$/)?.[1], file])
      .filter(([role]) => role),
  );
  const imageRoles = [
    ...new Set([
      "poster",
      ...(editor.imageSetSource ? [] : ["fanart", ...Object.keys(imageFiles)]),
      ...Object.keys(editor.images),
    ]),
  ];
  const savedImageSources = new Set(
    Object.keys(imageFiles).map(
      (role) =>
        detail.selection?.image_choices?.[role]?.source ??
        detail.selection?.image_source ??
        "unknown",
    ),
  );
  const currentImageSource =
    editor.imageSetSource ??
    (savedImageSources.size > 1
      ? "mixed"
      : ([...savedImageSources][0] ?? "unknown"));
  function chooseImageSet(source: string) {
    const variant = variants.find((v) => v.source === source);
    if (!variant?.metadata?.artwork) return;
    const items = variant.metadata.artwork;
    const images: Record<string, ImageChoice> = {};
    const cover = items.findIndex((item) => item.role !== "sample");
    if (cover >= 0) {
      images.poster = { source, index: cover };
      images.fanart = { source, index: cover };
    }
    items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.role === "sample")
      .slice(0, 100)
      .forEach(({ index }, i) => {
        images[`fanart${i + 1}`] = { source, index };
      });
    setEditor({ ...editor!, images, imageSetSource: source });
  }
  function imageLabel(role: string) {
    return role === "poster"
      ? "Emby 封面"
      : role === "fanart"
        ? "封套原图"
        : `剧照 ${role.slice(6)}`;
  }
  function preview(role: string) {
    const choice = editor!.images[role];
    if (choice && choice.index !== undefined)
      return `/api/${base}/variants/${choice.source}/artwork?index=${choice.index}&poster=${role === "poster"}`;
    return imageFiles[role] ? artwork(imageFiles[role]!) : null;
  }
  const renderField = ([key, label, type]: (typeof fields)[number]) => {
    const source = sourceOf(key);
    const options: Record<string, string> = {
      unknown: "来源未知",
      custom: "自定义",
      ...Object.fromEntries(
        variants
          .filter((v) => v.status === "found")
          .map((v) => [v.source, sources[v.source]!]),
      ),
    };
    if (!(source in options)) options[source] = sources[source] ?? source;
    const sourceVariant = variants.find((v) => v.source === source);
    const translated =
      source !== "custom" &&
      (editor.fieldSources[key]
        ? sourceVariant?.translated_fields
        : detail.selection?.translated_fields
      )?.includes(key);
    const original = (
      editor.fieldSources[key]
        ? sourceVariant?.original_fields
        : detail.selection?.original_fields
    )?.[key];
    const change = (value: string) =>
      setEditor({
        ...editor,
        draft: { ...draft, [key]: value },
        fieldSources: { ...editor.fieldSources, [key]: "custom" },
      });
    return (
      <div key={key} className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={`metadata-${key}`} className="text-sm font-medium">
            {label}
            {translated && (
              <span
                title={original}
                className="ml-2 rounded bg-muted px-1 text-xs"
              >
                译
              </span>
            )}
          </label>
          <Select
            label={`${label}来源`}
            value={source}
            onChange={(id) => perform(() => chooseField(key, id))}
            disabled={locked}
            options={options}
          />
        </div>
        {["textarea", "list"].includes(type) ? (
          <Textarea
            id={`metadata-${key}`}
            aria-label={label}
            required={key === "title"}
            rows={key === "plot" ? 6 : 2}
            value={draft[key]}
            onChange={(e) => change(e.target.value)}
          />
        ) : (
          <Input
            id={`metadata-${key}`}
            aria-label={label}
            type={type}
            min={type === "number" ? 0 : undefined}
            value={draft[key]}
            placeholder={key === "release_date" ? "2026年10月24日" : undefined}
            onChange={(e) => change(e.target.value)}
          />
        )}
        {source !== "custom" &&
          sourceVariant?.translation_errors
            ?.filter((error) => error.field === key)
            .map((error, index) => (
              <p key={index} className="text-xs text-destructive">
                翻译失败：{error.error}
              </p>
            ))}
      </div>
    );
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="icon" aria-label="返回" onClick={back}>
            <ArrowLeft />
          </Button>
          <h2 className="text-xl font-semibold">{detail.code}</h2>
          <Status
            status={
              detail.process?.status === "pending" ||
              detail.process?.status === "running"
                ? detail.process.status
                : detail.status
            }
          />
          {updatedAt && (
            <time
              dateTime={updatedAt}
              className="text-sm text-muted-foreground"
            >
              更新于 {formatDate(updatedAt, true)}
            </time>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Select
            label="刮削模式"
            value={mode}
            onChange={setMode}
            disabled={scrapeLocked}
            options={{
              fill_missing: "补齐缺失",
              refresh: "重新刮削",
            }}
          />
          <Button
            disabled={scrapeLocked || changed}
            onClick={() => perform(() => scrape())}
          >
            刮削元数据
          </Button>
        </div>
      </div>
      <form
        className="pb-8"
        onSubmit={(e) => {
          e.preventDefault();
          perform(save, "save");
        }}
      >
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-6">
            <fieldset disabled={locked}>{renderField(fields[0])}</fieldset>
            <section aria-label="作品图片" className="min-w-0 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium">封面</h3>
                <Select
                  label="图片来源"
                  value={currentImageSource}
                  disabled={locked}
                  onChange={chooseImageSet}
                  options={{
                    [currentImageSource]:
                      sources[currentImageSource] ??
                      (currentImageSource === "mixed"
                        ? "混合来源"
                        : "来源未知"),
                    ...Object.fromEntries(
                      variants
                        .filter(
                          (v) =>
                            v.status === "found" && v.metadata?.artwork?.length,
                        )
                        .map((v) => [
                          v.source,
                          `${sources[v.source]} · ${v.metadata!.artwork!.filter((a) => a.role === "sample").length} 张剧照`,
                        ]),
                    ),
                  }}
                />
              </div>
              <div className="grid grid-cols-2 items-start gap-4 sm:grid-cols-4">
                {imageRoles.map((role) => {
                  const image = preview(role);
                  return (
                    <Fragment key={role}>
                      {role ===
                        imageRoles.find((item) => /^fanart\d+$/.test(item)) && (
                        <h3 className="col-span-full text-sm font-medium">
                          剧照
                        </h3>
                      )}
                      <div
                        className={`min-w-0 space-y-2 ${role === "poster" ? "col-span-full sm:col-span-1" : role === "fanart" ? "col-span-full sm:col-span-3" : ""}`}
                      >
                        {image ? (
                          <Button
                            type="button"
                            variant="artwork"
                            size={
                              role === "poster"
                                ? "poster"
                                : role === "fanart"
                                  ? "fanart"
                                  : "sample"
                            }

                            aria-label={`裁剪${imageLabel(role)}图片`}
                            disabled={locked || changed || !imageFiles[role]}
                            onClick={() =>
                              setCropFile(
                                role === "poster"
                                  ? (imageFiles.fanart ?? imageFiles[role]!)
                                  : imageFiles[role]!,
                              )
                            }
                          >
                            <img
                              src={image}
                              alt={imageLabel(role)}
                              className="h-auto w-auto max-h-full max-w-full object-contain"
                              loading="lazy"
                            />
                          </Button>
                        ) : (
                          <Empty>暂无{imageLabel(role)}</Empty>
                        )}
                      </div>
                    </Fragment>
                  );
                })}
              </div>
            </section>
            <section aria-label="作品元数据" className="min-w-0 space-y-4">
              {detail.metadata_error && (
                <p className="text-sm text-destructive">
                  {detail.metadata_error}
                </p>
              )}

              <fieldset disabled={locked} className="space-y-4">
                {fields.slice(1).map(renderField)}
              </fieldset>
              <div className="space-y-2 break-all border-t pt-4 pb-6 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">文件路径</p>
                {detail.media_files.map((file) => (
                  <p key={file}>{file}</p>
                ))}
              </div>
            </section>
          </div>
          <section
            aria-label="刮削进度"
            className="min-w-0 space-y-4 rounded-lg border bg-muted/20 p-4 lg:sticky lg:top-4"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold">刮削进度</h3>
                {detail.process?.sequence && (
                  <span className="text-sm text-muted-foreground">
                    {taskId ||
                    detail.process.status === "pending" ||
                    detail.process.status === "running"
                      ? "任务"
                      : "最近任务"}{" "}
                    #{detail.process.sequence}
                  </span>
                )}
              </div>
              <Process
                events={detail.process?.events ?? []}
                running={detail.process?.status === "running"}
              />
            </div>
            <div className="space-y-3">
              {route.map((id) => {
                const state = sourceProgress(detail, id);
                return (
                  <div
                    key={id}
                    className="space-y-2 rounded-lg border bg-background p-3 text-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{sources[id]}</span>
                      {state.status !== "missing" && (
                        <Status status={state.status} label={state.label} />
                      )}
                    </div>
                    {(state.phase || state.elapsed !== undefined) && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                        {state.elapsed !== undefined && (
                          <span className="tabular-nums">
                            {state.status === "running" || state.status === "pending" ? "已用" : "用时"}{" "}
                            {state.elapsed.toFixed(1)} 秒
                          </span>
                        )}
                        {state.phase && <span>{state.phase}</span>}
                      </div>
                    )}
                    {state.message && (
                      <p className="break-words text-muted-foreground">
                        {state.message}
                      </p>
                    )}
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={scrapeLocked}
                        onClick={() => perform(() => scrape(id))}
                      >
                        {state.action}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
            <Diagnostics report={detail.process?.result} />
          </section>
        </div>
        <div className="h-8" aria-hidden="true" />
        <StickyActions>
          <Button type="submit" disabled={locked || !changed}>
            {pending === "save" ? "保存中" : "保存"}
          </Button>
        </StickyActions>
      </form>
      {cropFile && (
        <Suspense fallback={<Empty>正在载入裁剪…</Empty>}>
          <CropEditor
            detail={detail}
            file={cropFile}
            busy={locked}
            saving={!!pending}
            setSaving={(saving) => setPending(saving ? "save" : null)}
            artwork={artwork}
            close={() => setCropFile(null)}
            run={run}
            saved={(value) => {
              accept(value);
              setCropFile(null);
              saved(value);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
