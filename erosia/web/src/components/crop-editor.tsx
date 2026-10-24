import { useCallback, useEffect, useRef, useState } from "react";
import ReactCrop, { type PercentCrop } from "react-image-crop";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { cropBox, percentCrop } from "@/lib/crop";
import type { Box, Crop, WorkDetail } from "@/lib/types";

export default function CropEditor({
  detail,
  file,
  busy,
  artwork,
  close,
  run,
  saved,
  saving,
  setSaving,
}: {
  saving: boolean;
  setSaving: (value: boolean) => void;
  detail: WorkDetail;
  file: string;
  busy: boolean;
  artwork: (file: string) => string;
  close: () => void;
  run: (fn: () => Promise<void>) => void;
  saved: (detail: WorkDetail) => void;
}) {
  const [result, setResult] = useState<Crop | null>(null);
  const [selection, setSelection] = useState<PercentCrop>();
  const [pending, setPending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const base = `works/${encodeURIComponent(detail.code)}/crop`;
  const preview = useCallback(
    async (body: {
      file: string;
      center?: boolean;
      box?: Box;
      fingerprint?: string;
    }) => {
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      const ticket = ++request.current;
      setPending(true);
      setConfirmed(false);
      setError("");
      try {
        const value = await api<Crop>(base, "POST", body, abort.signal);
        if (abort.signal.aborted || ticket !== request.current) return;
        setResult(value);
        setSelection(percentCrop(value.box, value.width, value.height));
        setConfirmed(true);
      } catch (e) {
        if (!abort.signal.aborted && ticket === request.current)
          setError(e instanceof Error ? e.message : "裁剪失败");
      } finally {
        if (!abort.signal.aborted && ticket === request.current)
          setPending(false);
      }
    },
    [base],
  );
  useEffect(() => {
    setResult(null);
    setSelection(undefined);
    void preview({ file });
    return () => {
      controller.current?.abort();
      request.current++;
    };
  }, [file, preview]);
  const locked = busy || saving;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) close();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="h-[90dvh] max-h-[90dvh] grid-rows-[auto_auto_minmax(0,1fr)_24px_auto] overflow-hidden sm:max-w-4xl"
        showCloseButton={!saving}
      >
        <DialogHeader>
          <DialogTitle>调整封面</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            disabled={locked || pending}
            onClick={() => void preview({ file })}
          >
            人脸裁剪
          </Button>
          <Button
            variant="outline"
            disabled={locked || pending}
            onClick={() => void preview({ file, center: true })}
          >
            居中裁剪
          </Button>
        </div>
        <div className="grid min-h-0 items-start gap-4 overflow-auto sm:grid-cols-[1fr_140px]">
          <div className="min-w-0 rounded-md border bg-muted/30 p-2">
            <ReactCrop
              crop={selection}
              aspect={2 / 3}
              keepSelection
              disabled={locked || !result}
              minWidth={16}
              minHeight={24}
              ariaLabels={{
                cropArea: "裁剪选框",
                nwDragHandle: "左上缩放",
                nDragHandle: "上侧缩放",
                neDragHandle: "右上缩放",
                eDragHandle: "右侧缩放",
                seDragHandle: "右下缩放",
                sDragHandle: "下侧缩放",
                swDragHandle: "左下缩放",
                wDragHandle: "左侧缩放",
              }}
              onChange={(_, percent) => {
                controller.current?.abort();
                request.current++;
                setPending(false);
                setConfirmed(false);
                setSelection(percent);
              }}
              onComplete={(_, percent) => {
                if (result && !locked)
                  void preview({
                    file,
                    box: cropBox(percent, result.width, result.height),
                    fingerprint: result.fingerprint,
                  });
              }}
            >
              <img
                src={artwork(file)}
                alt="裁剪原图"
                className="block max-h-[55dvh] max-w-full object-contain"
                draggable={false}
              />
            </ReactCrop>
          </div>
          {result && (
            <div className="space-y-2">
              <img
                src={result.preview}
                className="mx-auto aspect-[2/3] w-32 rounded-md"
                alt="裁剪预览"
              />
              <p className="text-center text-xs text-muted-foreground">
                2:3 预览
              </p>
            </div>
          )}
        </div>
        <p
          role={error ? "alert" : "status"}
          className={`text-sm ${error ? "text-destructive" : "text-muted-foreground"}`}
        >
          {error || (pending ? "正在生成预览…" : "\u00a0")}
        </p>
        <div className="flex justify-end">
          <Button
            disabled={locked || pending || !confirmed || !result || !!error}
            onClick={() =>
              run(async () => {
                if (!result || !confirmed) return;
                setSaving(true);
                try {
                  saved(
                    await api<WorkDetail>(base, "PUT", {
                      file,
                      box: result.box,
                      fingerprint: result.fingerprint,
                    }),
                  );
                } finally {
                  setSaving(false);
                }
              })
            }
          >
            {saving ? "保存中" : "保存封面"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
