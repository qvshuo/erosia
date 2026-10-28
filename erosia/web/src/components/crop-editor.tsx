import { useCallback, useEffect, useRef, useState } from "react";
import ReactCrop, { type PercentCrop } from "react-image-crop";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArtworkImage } from "./shared";
import { errorText } from "@/lib/messages";
import { api } from "@/lib/api";
import { cropBox, percentCrop } from "@/lib/crop";
import type { Box, Crop, ImageChoice } from "@/lib/types";

export default function CropEditor({
  code, input, image, applyLabel, coverPreview, busy, close, applied,
}: {
  code: string;
  input: ImageChoice;
  image: string;
  applyLabel: "应用裁剪" | "设为封面";
  coverPreview?: string;
  busy: boolean;
  close: () => void;
  applied: (crop: Crop) => void;
}) {
  const [result, setResult] = useState<Crop | null>(null);
  const [loadedImage, setLoadedImage] = useState<string>();
  const [selection, setSelection] = useState<PercentCrop>();
  const [pending, setPending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const base = `works/${encodeURIComponent(code)}/crop`;
  const preview = useCallback(
    async (body: {
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
        const value = await api<Crop>(base, "POST", { ...input, ...body }, abort.signal);
        if (abort.signal.aborted || ticket !== request.current) return;
        setResult(value);
        setSelection(percentCrop(value.box, value.width, value.height));
        setConfirmed(true);
      } catch (e) {
        if (!abort.signal.aborted && ticket === request.current)
          setError(errorText(e));
      } finally {
        if (!abort.signal.aborted && ticket === request.current)
          setPending(false);
      }
    },
    [base, input],
  );
  useEffect(() => {
    setResult(null);
    setSelection(undefined);
    setConfirmed(false);
    setPending(false);
    setError("");
    return () => {
      controller.current?.abort();
      request.current++;
    };
  }, [input]);
  const locked = busy || loadedImage !== image;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="h-[90dvh] max-h-[90dvh] grid-rows-[auto_auto_auto_minmax(0,1fr)_auto_auto] overflow-hidden sm:max-w-4xl"
      >
        <DialogHeader>
          <DialogTitle>调整封面</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            disabled={locked || pending}
            onClick={() => void preview({})}
          >
            人脸裁剪
          </Button>
          <Button
            variant="outline"
            disabled={locked || pending}
            onClick={() => void preview({ center: true })}
          >
            居中裁剪
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">{busy ? "作品处理中，暂不能修改" : loadedImage !== image ? error ? "请返回后重新打开图片" : "正在加载原图…" : "先选择裁剪方式，再调整选区"}</p>
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
                    box: cropBox(percent, result.width, result.height),
                    fingerprint: result.fingerprint,
                  });
              }}
            >
              <ArtworkImage
                src={image}
                onLoad={() => setLoadedImage(image)}
                onError={() => { setLoadedImage(undefined); setError("原图加载失败，请返回后重试"); }}
                alt="裁剪原图"
                className="block max-h-[55dvh] max-w-full object-contain"
                draggable={false}
              />
            </ReactCrop>
          </div>
          {(result || coverPreview) && (
            <div className="space-y-2">
              <ArtworkImage
                src={result?.preview ?? coverPreview}
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
          className={`min-h-5 break-words text-sm ${error ? "text-destructive" : "text-muted-foreground"}`}
        >
          {error || (pending ? "正在生成预览…" : "\u00a0")}
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={close}>返回</Button>
          <Button
            disabled={locked || pending || !confirmed || !result || !!error}
            onClick={() => { if (result && confirmed) applied(result); }}
          >
            {applyLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
