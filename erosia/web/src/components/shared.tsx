import {
  useEffect,
  useState,
  type ReactNode,
  type MouseEvent,
  type KeyboardEvent,
} from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select as SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { statuses } from "@/lib/api";

export function SummaryHeader({
  count,
  unit,
  suffix = "",
  children,
}: {
  count: number;
  unit: string;
  suffix?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3">
      <p className="text-base leading-6 font-medium tabular-nums">
        {count} {unit}
        {suffix}
      </p>
      {children}
    </div>
  );
}

export function Status({ status, label }: { status: string; label?: string }) {
  if (!statuses[status]) return null;
  return (
    <Badge
      className={`${status === "running" ? "border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-500 dark:text-emerald-950" : ["found", "success", "scraped"].includes(status) ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : ["partial", "cooldown", "rate_limited"].includes(status) ? "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400" : ""}`}
      variant={
        [
          "failed",
          "invalid_key",
          "conflict",
          "network_error",
          "parse_error",
          "timeout",
          "identity_mismatch",
          "blocked",
          "ip_blocked",
          "region_blocked",
        ].includes(status)
          ? "destructive"
          : "secondary"
      }
    >
      {label ?? statuses[status] ?? status}
    </Badge>
  );
}
export function SearchInput({
  value,
  onChange,
  label = "搜索作品",
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <div className="relative min-w-40 flex-1">
      <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
      <Input
        type="search"
        disabled={disabled}
        className="pl-9"
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
export function Select({
  value,
  onChange,
  label,
  options,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  options: Record<string, string>;
  disabled?: boolean;
}) {
  return (
    <SelectRoot value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger aria-label={label} className="max-w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        {Object.entries(options).map(([id, text]) => (
          <SelectItem key={id} value={id}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </SelectRoot>
  );
}
export function Pagination({
  page,
  pages,
  total,
  onChange,
  pageSize,
  onPageSizeChange,
}: {
  page: number;
  pages: number;
  total: number;
  onChange: (page: number) => void;
  pageSize: number;
  onPageSizeChange: (pageSize: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm">
      <span className="text-muted-foreground">共 {total} 条</span>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          label="每页条数"
          value={String(pageSize)}
          onChange={(value) => {
            onPageSizeChange(Number(value));
            onChange(1);
          }}
          options={{
            100: "100 条/页",
            1000: "1000 条/页",
            10000: "10000 条/页",
          }}
        />
        <Button
          variant="outline"
          size="icon"
          aria-label="上一页"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft />
        </Button>
        <Select
          label="页码"
          value={String(page)}
          onChange={(n) => onChange(Number(n))}
          options={Object.fromEntries(
            Array.from({ length: pages }, (_, i) => [
              i + 1,
              `${i + 1} / ${pages}`,
            ]),
          )}
        />
        <Button
          variant="outline"
          size="icon"
          aria-label="下一页"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
export function Empty({ children = "暂无记录" }: { children?: ReactNode }) {
  return (
    <p className="p-12 text-center text-sm text-muted-foreground">{children}</p>
  );
}

// Row navigation leaves embedded controls and text selection independent.
export function rowNavigation(open: () => void, className = "") {
  return {
    tabIndex: 0,
    className: `cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${className}`,
    onClick(event: MouseEvent<HTMLElement>) {
      if (
        (event.target as HTMLElement).closest(
          "button,a,input,label,summary,[role=checkbox],[role=combobox]",
        ) ||
        window.getSelection()?.toString()
      )
        return;
      open();
    },
    onKeyDown(event: KeyboardEvent<HTMLElement>) {
      if (
        event.target !== event.currentTarget ||
        !["Enter", " "].includes(event.key)
      )
        return;
      event.preventDefault();
      open();
    },
  };
}
export function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label
      className={`grid min-w-0 gap-2 text-sm ${wide ? "sm:col-span-2" : ""}`}
    >
      {label}
      {children}
    </label>
  );
}
export function useDebounce<T>(value: T, delay = 250): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
export interface Confirmation {
  title: string;
  description: ReactNode;
  resolve: (answer: boolean) => void;
}
export type Confirm = (
  title: string,
  description: ReactNode,
) => Promise<boolean>;
export function ConfirmationDialog({
  value,
  close,
}: {
  value: Confirmation | null;
  close: (answer: boolean) => void;
}) {
  return (
    <Dialog
      open={!!value}
      onOpenChange={(open) => {
        if (!open) close(false);
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{value?.title}</DialogTitle>
          <DialogDescription asChild>
            <div className="whitespace-pre-wrap break-words">
              {value?.description}
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            取消
          </Button>
          <Button onClick={() => close(true)}>确认</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface EditState {
  dirty: boolean;
  saving: boolean;
}
export type EditReporter = (state: EditState) => void;

export function StickyActions({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-20 -mx-4 flex items-center justify-end gap-4 border-t bg-background/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:-mx-8 sm:px-8">
      {children}
    </div>
  );
}

export function WorkTitle({ title }: { title?: string | null }) {
  return (
    <span className="block truncate" title={title || undefined}>
      {title || "—"}
    </span>
  );
}
