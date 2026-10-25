import asyncio
import fcntl
import logging
import sqlite3
import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .actors import ActorAliases
from .catalog import CatalogRules
from .engine import Scraper
from .images import Gfriends
from .http import WebClient
from .logging import progress, work_code
from .logging import task_id as log_task_id
from .models import Category, SourceId, ScrapeRequest
from .nfo import existing_nfo, nfo_paths, read_nfo
from .processing import process_work, retry_work, retry_task_report
from .runtime import RuntimeStore, now, runtime_directory
from .scanner import scan, validate_roots
from .settings import Settings
from .translation import Translator

logger = logging.getLogger(__name__)


class TaskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal[
        "fill_missing",
        "fetch_source",
        "refresh",
        "retry_incomplete",
    ]
    codes: list[str] = Field(default_factory=list)
    source_id: SourceId | None = None
    retry_stages: list[Literal["images", "translation", "portraits"]] = Field(default_factory=list)
    retry_only: bool = False


class TaskQueue:
    def __init__(self, settings: Settings, *, scraper_factory=Scraper):
        if not settings.media_directories or settings.metadata_directory is None:
            raise ValueError("media_directories and metadata_directory are required")
        validate_roots(
            settings.media_directories, settings.metadata_directory, require_existing=False
        )
        self.settings = settings
        actor_file = runtime_directory(settings.metadata_directory) / "actor_aliases.json"
        if settings.actor_aliases_file is None and actor_file.is_file():
            settings.actor_aliases_file = actor_file
        self.output = settings.metadata_directory.resolve()
        internal = runtime_directory(self.output)
        if internal.is_symlink():
            raise ValueError("runtime directory must not be a symlink")
        internal.mkdir(parents=True, exist_ok=True)
        lock = internal / "service.lock"
        if lock.is_symlink():
            raise ValueError("service lock must not be a symlink")
        self.process_lock = lock.open("a")
        try:
            fcntl.flock(self.process_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.runtime = RuntimeStore(self.output)
        except OSError, ValueError, sqlite3.Error:
            self.process_lock.close()
            raise ValueError(
                "runtime records are unreadable or another erosia writer is active"
            ) from None
        self.running = {}
        self.task_lock = asyncio.Lock()
        self._run_lock = asyncio.Lock()
        self._work_locks = {}
        self._running_codes = set()
        self.pending_settings = None
        self.on_idle = None
        self.scraper_factory = scraper_factory
        self.translator = Translator(settings.translation)
        self._artwork_client = None
        self._artwork_lock = asyncio.Lock()
        self.closed = False
        for row in self.runtime.works_data:
            if row["status"] not in ("invalid_key", "conflict"):
                work = self.runtime.work(row["code"])
                self._apply_result(work, self.runtime.results.get(work.code, {}))
                row.update(work.model_dump(mode="json"))


    async def artwork_client(self):
        async with self._artwork_lock:
            if self._artwork_client is None:
                client = WebClient(self.settings, runtime=self.runtime)
                await client.__aenter__()
                self._artwork_client = client
            return self._artwork_client

    def work_lock(self, code):
        return self._work_locks.setdefault(code, asyncio.Lock())

    def work_running(self, code):
        return code in self._running_codes

    async def apply_pending_settings(self):
        updated = self.pending_settings
        if updated is None or updated.metadata_directory is None or not updated.media_directories or updated.metadata_directory.resolve() != self.output:
            return
        # Called only between batches; no worker observes a partially changed configuration.
        old = self.translator
        if updated.media_directories != self.settings.media_directories:
            rows = await asyncio.to_thread(self._scan_rows, updated, self.runtime.results, set(), False)
            self.runtime.save_scan(rows)
        self.settings = updated
        self.translator = Translator(updated.translation)
        if self._artwork_client is not None:
            self._artwork_client.settings = updated
        self.pending_settings = None
        await old.close()

    def active(self):
        return [t for t in self.runtime.tasks() if t["status"] in ("pending", "running")]

    def _apply_result(self, work, result):
        work.title, work.actors = None, []
        work.warnings = [warning for warning in work.warnings if warning != "NFO 无效，等待补抓"]
        work.status = "failed" if result.get("status") not in (None, "found", "unchanged") else "pending"
        if existing_nfo(self.output, work).is_file():
            try:
                for path in nfo_paths(self.output, work):
                    metadata = read_nfo(path, work.code)
                    work.title, work.actors = metadata.title, [a.name for a in metadata.actors]
                work.status = "partial" if result.get("partial") else "scraped" if work.status != "failed" else "failed"
            except (ValueError, OSError):
                work.title, work.actors = None, []
                work.warnings.append("NFO 无效，等待补抓")

    def _scan_rows(self, options, results, previous, persist):
        works = scan(options.media_directories)
        rules = CatalogRules.load(options.catalog_rules_file)
        for work in works:
            if work.status == "pending":
                result = results.get(work.code, {})
                work.category = Category(result.get("category", rules.classify(work.code).category))
                self._apply_result(work, result)
            elif persist and (str(work.path), work.code, work.status) not in previous:
                logger.warning("跳过 %s：%s", work.code, "; ".join(work.warnings))
        return works

    def refresh_work(self, code):
        work = self.runtime.work(code)
        self._apply_result(work, self.runtime.results.get(code, {}))
        self.runtime.update_work(work)

    async def scan_async(self, *, settings=None, persist=True):
        if self.active():
            raise ValueError("cannot scan while a task is active")
        options, results = settings or self.settings, self.runtime.results
        previous = {(m["path"], m["code"], m["status"]) for m in self.runtime.works()}
        works = await asyncio.to_thread(self._scan_rows, options, results, previous, persist)
        if self.active():
            raise ValueError("cannot scan while a task is active")
        # Do not publish an old filesystem snapshot after a write or configuration switch.
        if persist:
            if (
                self.closed
                or options is not self.settings
                or results is not self.runtime.results
            ):
                return self.runtime.works()
            self.runtime.save_scan(works)
        return [work.model_dump(mode="json") for work in works]

    def create(self, request: TaskRequest):
        if self.task_lock.locked() and not self.active():
            raise ValueError("cannot create tasks while metadata is being edited")
        validate_roots(self.settings.media_directories, self.output)
        if request.type == "fetch_source" and request.source_id is None:
            raise ValueError("fetch_source requires source_id")
        if request.type == "fetch_source" and len(request.codes) != 1:
            raise ValueError("单源刮削需要指定一个作品")
        eligible = {
            m["code"]
            for m in self.runtime.works()
            if m["status"] not in ("invalid_key", "conflict")
        }
        keys = sorted(set(request.codes) if request.codes else eligible)
        if not keys or any(k not in eligible for k in keys):
            raise ValueError("no eligible works or requested directory is invalid/conflicting")
        if request.type != "fetch_source" and request.source_id is not None:
            raise ValueError("批次使用已配置的来源顺序")
        params = request.model_dump(mode="json")
        params["codes"] = keys
        for task in self.active():
            if task["params"] == params:
                return self.runtime.task(task["id"])
            if set(keys) & set(task["params"]["codes"]):
                raise ValueError("task overlaps an active write task")
        ident = uuid.uuid4().hex
        task = {
            "id": ident,
            "type": request.type,
            "status": "pending",
            "params": params,
            "total": len(keys),
            "progress": 0,
            "success": 0,
            "failed": 0,
            "created_at": now(),
            "finished_at": None,
            "error": None,
            "items": [
                {"code": key, "status": "pending", "attempts": 0, "result": None} for key in keys
            ],
        }
        self.runtime.save_task(task)
        worker = asyncio.create_task(self.run(ident))
        self.running[ident] = worker
        worker.add_done_callback(lambda _: self.running.pop(ident, None))
        return self.runtime.task(ident)

    def delete(self, ident):
        task = self.runtime.task_data[ident]
        if task["status"] in ("pending", "running"):
            raise ValueError("cancel the task before deleting it")
        self.runtime.delete_task(ident)
        return {"deleted": True}

    async def cancel(self, ident):
        task = self.runtime.task_data[ident]
        if task["status"] not in ("pending", "running"):
            raise ValueError("task is not active")
        worker = self.running.get(ident)
        if worker:
            worker.cancel()
            await asyncio.gather(worker, return_exceptions=True)
        for item in task["items"]:
            if item["status"] in ("pending", "running"):
                item.update(status="cancelled", result=None)
                event = {
                    "stage": "finished",
                    "status": "cancelled",
                    "source": None,
                    "message": "任务已取消",
                    "time": now(),
                }
                item["events"] = [*item.get("events", []), event][-60:]
                item["stage"] = event
        task.update(status="cancelled", finished_at=now(), current=None)
        self.runtime.save_task(task)
        active_keys = {key for other in self.active() for key in other["params"]["codes"]}
        for code in task["params"]["codes"]:
            if code not in active_keys:
                self.refresh_work(code)
        result = self.runtime.task(ident)
        if not self.closed and not self.active() and self.on_idle:
            await self.on_idle()
        return result

    def retry(self, ident):
        task = self.runtime.task(ident)
        if task["status"] in ("running", "pending"):
            raise ValueError("cannot retry active task")
        keys = [i["code"] for i in task["items"] if i["status"] in ("failed", "cancelled", "partial")]
        if not keys:
            raise ValueError("task contains no failed items")
        return self.create(TaskRequest.model_validate({**{key: value for key, value in task["params"].items() if key in TaskRequest.model_fields}, "codes": keys, "retry_only": True}))

    async def run(self, ident):
        async with self._run_lock:
            await self._run(ident)
        if not self.closed and not self.active() and self.on_idle:
            await self.on_idle()

    async def _run(self, ident):
        log_task_id.set(ident)
        task = self.runtime.task_data[ident]
        request = TaskRequest.model_validate(task["params"])
        task["status"] = "running"
        self.runtime.save_task(task)
        try:
            async with self.task_lock:
                await self.apply_pending_settings()
            await self.translator.verify(force=True)
            names = ActorAliases.load(self.settings.actor_aliases_file)
            self.runtime.save_issues(names.pending(self.runtime.issues))
            async with self.scraper_factory(self.settings) as scraper, Gfriends(self.settings, names, self.output) as portraits:
                if hasattr(scraper.client, "cooldowns"):
                    scraper.client.runtime = self.runtime
                    scraper.client.cooldowns = self.runtime.cooldowns()
                async def process_item(item):
                    async with self.work_lock(item["code"]):
                        self._running_codes.add(item["code"])
                        try:
                            await process_locked_item(item)
                        finally:
                            self._running_codes.discard(item["code"])

                async def process_locked_item(item):
                    work_code.set(item["code"])
                    item.update(status="running", attempts=item["attempts"] + 1)
                    self.runtime.work_row(item["code"])["status"] = "running"
                    self.runtime.save_task(task, item)

                    def update_progress(event):
                        item["events"] = [*item.get("events", []), event][-60:]
                        item["stage"] = event
                        task["current"] = {"code": item["code"], **event}
                        self.runtime.save_task(task, item)

                    previous = self.runtime.results.get(item["code"], {})
                    repairing = request.type == "retry_incomplete" or request.retry_only and previous.get("partial")
                    repair_stages = request.retry_stages or previous.get("incomplete_stages", [])
                    token = progress.set(update_progress)
                    try:
                        report = await self.process(scraper, self.runtime.work(item["code"]), names, request, portraits)
                    except Exception as exc:
                        logger.exception("处理 %s 失败", item["code"])
                        report = {"code": item["code"], "status": "error", "error": str(exc)}
                    finally:
                        progress.reset(token)
                    if self.settings.translation.enabled and not self.translator.available:
                        report["warnings"] = [*report.get("warnings", []), "翻译服务不可用：" + self.translator.validation_error]
                    task_report = retry_task_report(report, repair_stages) if repairing else report
                    outcome = "partial" if task_report.get("partial") else "success" if task_report["status"] in ("found", "unchanged") else "failed"
                    item.update(status=outcome, result=task_report)
                    # A failed attempt does not replace the health of unchanged output files.
                    if request.type != "fetch_source" and (report["status"] in ("found", "unchanged") or not self.runtime.results.get(item["code"])):
                        self.runtime.record_result(item["code"], report)
                    self.refresh_work(item["code"])
                    update_progress({"stage": "finished", "status": outcome, "source": None,
                                     "message": None, "time": now()})
                    logger.info("番号 %s：%s", item["code"], report["status"])

                pending = iter(task["items"])
                async def worker():
                    for item in pending:
                        await process_item(item)
                async with asyncio.TaskGroup() as group:
                    for _ in range(min(10, len(task["items"]))):
                        group.create_task(worker())
            task.update(status="finished", current=None, finished_at=now())
        except Exception as exc:
            logger.exception("任务 %s 失败", ident)
            for item in task["items"]:
                if item["status"] in ("pending", "running"):
                    event = {"stage": "finished", "status": "failed", "source": None,
                             "message": str(exc), "time": now()}
                    item.update(status="failed", result={"code": item["code"], "status": "error", "error": str(exc)}, stage=event)
                    item["events"] = [*item.get("events", []), event][-60:]
                    rows = self.runtime.works(codes=[item["code"]])
                    if len(rows) == 1 and rows[0]["status"] not in ("invalid_key", "conflict"):
                        self.refresh_work(item["code"])
            task.update(status="finished", current=None, error=str(exc), finished_at=now())
        self.runtime.save_task(task)

    async def process(self, scraper, work, names, request, portraits):
        if request.type == "fetch_source":
            result = await scraper.scrape(ScrapeRequest(code=work.code, source=request.source_id),
                on_result=lambda variant: self.runtime.save_variant(work.code, variant.model_dump(mode="json")))
            return {"code": work.code, "status": result.status.value, "warnings": result.warnings,
                "sources": [v.report() for v in result.results]}
        if request.type == "retry_incomplete" or (request.retry_only and self.runtime.results.get(work.code, {}).get("partial")):
            stages = request.retry_stages or self.runtime.results.get(work.code, {}).get("incomplete_stages", [])
            if not stages:
                raise ValueError("没有待重试阶段")
            return await retry_work(scraper, work, self.output, self.translator, self.runtime, portraits, stages)
        return await process_work(
            scraper,
            work,
            self.output,
            names,
            self.translator,
            missing_only=request.type == "fill_missing",
            portraits=portraits,
            runtime=self.runtime,
        )

    async def close(self):
        self.closed = True
        for task in self.active():
            await self.cancel(task["id"])
        if self._artwork_client is not None:
            await self._artwork_client.__aexit__(None, None, None)
        await self.translator.close()
        self.runtime.close()
        self.process_lock.close()
