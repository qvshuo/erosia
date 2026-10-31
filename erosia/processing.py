import logging
from pathlib import Path

from .actors import ActorAliases, actor_type
from .contract import EDITABLE_FIELDS
from .engine import Scraper
from .images import save_images
from .logging import report_progress
from .models import Artwork, Metadata, ScrapeRequest, Status
from .nfo import existing_nfo, media_stems, read_nfo, serialize_nfo, target_folder, write_nfo_files
from .scanner import Work
from .storage import file_transaction
from .translation import Translator

logger = logging.getLogger(__name__)


def resolve_actor_names(metadata: Metadata, names: ActorAliases, category=None) -> list[dict]:
    actors, issues, seen = [], [], set()
    kind = actor_type(metadata.classification.category, category)
    for actor in metadata.actors:
        primary = names.resolve(actor.name, kind)
        if primary:
            actor = actor.model_copy(update={"name": primary})
        else:
            candidates = names.candidates(actor.name, kind)
            if len(candidates) > 1:
                issues.append({"name": actor.name, "type": kind, "status": "ambiguous", "candidates": candidates})
                logger.warning("演员名称存在歧义，保留来源名字：%s", actor.name)
        if actor.name not in seen:
            actors.append(actor)
            seen.add(actor.name)
    metadata.actors = actors
    return issues


def complete_report(report):
    stages = report.setdefault("stages", {})
    incomplete = [stage for stage, state in stages.items() if state in ("failed", "pending", "cancelled")]
    report["incomplete_stages"] = incomplete
    report["partial"] = bool(incomplete) and stages.get("metadata") == "success"
    return report


def retry_task_report(report, stages):
    """A repair task reports its own work; the cumulative output report stays in runtime."""
    states = {stage: report.get("stages", {}).get(stage, "skipped") for stage in stages}
    incomplete = [stage for stage, state in states.items() if state in ("failed", "pending", "cancelled")]
    result = {"code": report["code"], "status": report["status"], "stages": states,
              "sources": [], "incomplete_stages": incomplete, "partial": bool(incomplete)}
    if report.get("error"):
        result["error"] = report["error"]
    for stage, key in {"images": "images", "translation": "translation_errors", "portraits": "portraits"}.items():
        if stage in states:
            result[key] = report.get(key, [])
    if "translation" in states:
        result["warnings"] = [warning for warning in report.get("warnings", []) if warning.startswith("翻译")]
    return result


def image_manifest(target, work):
    return [p.name for p in target.iterdir() if p.is_file() and not p.is_symlink()
            and p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".gif"}
            and any(p.stem.startswith(stem + "-") for stem in media_stems(work))] if target.is_dir() else []


async def write_artwork(client, work, output, request, selection):
    target = target_folder(output, work.code)
    previous = image_manifest(target, work)
    image_choices = dict(selection.get("image_choices", {}))
    for name in previous:
        for stem in media_stems(work):
            if Path(name).stem.startswith(stem + "-"):
                image_choices.setdefault(Path(name).stem[len(stem) + 1:],
                                         {"source": selection.get("image_source", "unknown")})
    protected = set(request.get("protected_roles", [])) | {role for role, choice in image_choices.items()
                 if choice.get("source") == "custom" and not request["overwrite_custom"]}
    previous = [name for name in previous if not any(
        Path(name).stem == f"{stem}-{role}" for stem in media_stems(work) for role in protected)]
    items = [Artwork.model_validate(item) for item in request["artwork"]]
    records = await save_images(client, items, target, media_stems(work),
        missing_only=request["missing_only"], previous_files=previous, protected_roles=protected)
    for record in records:
        if record["status"] == "saved":
            for stem in media_stems(work):
                name = Path(record["file"]).stem
                if name.startswith(stem + "-"):
                    image_choices[name[len(stem) + 1:]] = {"source": request["source"]}
    selection["image_choices"] = image_choices
    if any(record["status"] == "error" for record in records):
        selection["pending_images"] = request
    else:
        if request["overwrite_custom"]:
            selection["image_choices"] = {role: choice for role, choice in image_choices.items()
                                          if choice.get("source") != "custom" or role in request.get("protected_roles", [])}
        selection["image_source"] = request["source"]
        selection.pop("pending_images", None)
    return records


async def process_work(scraper: Scraper, work: Work, output: Path, names: ActorAliases,
                       translator: Translator, *, runtime, missing_only=False, portraits=None):
    result = await scraper.scrape(ScrapeRequest(code=work.code),
        on_result=lambda variant: runtime.save_variant(work.code, variant.model_dump(mode="json")))
    report = {"code": work.code, "status": result.status.value, "category": result.classification.category,
              "warnings": result.warnings, "selected_source": result.selected_source,
              "sources": [r.report() for r in result.results]}
    if result.status != Status.FOUND or result.metadata is None:
        return report
    selected = next(v.model_dump(mode="json") for v in result.results if v.source == result.selected_source)
    candidate = Metadata.model_validate(selected["metadata"])
    candidate.code = work.code
    selection = runtime.selection(work.code)
    customized = {field for field, source in selection.get("field_sources", {}).items() if source == "custom"} if missing_only else set()
    previous = None
    path = existing_nfo(output, work)
    if path.is_file():
        try:
            previous = read_nfo(path, work.code)
        except ValueError:
            pass
    protected = {field for field in EDITABLE_FIELDS
                 if missing_only and previous
                 and (field in customized or getattr(previous, field) not in (None, "", []))}
    report["actor_issues"] = resolve_actor_names(candidate, names, work.category) if "actors" not in protected else []
    selected["metadata"] = candidate.model_dump(mode="json")
    fields = tuple(field for field in ("title", "plot") if field not in protected)
    report_progress("translation" if translator.enabled and fields else "metadata")
    selected = await translator.variant(selected, fields=fields)
    runtime.save_variant(work.code, selected)
    metadata = Metadata.model_validate(selected["metadata"])
    if missing_only and previous and previous.series:
        metadata.series = previous.series
    for field in protected:
        setattr(metadata, field, getattr(previous, field))
    previous_report = runtime.results.get(work.code, {})
    report["translation_errors"] = [error for error in selected["translation_errors"] if error["field"] in fields]
    report["translation_errors"] += [error for error in previous_report.get("translation_errors", [])
                                     if error["field"] in protected and error["field"] not in customized]
    if previous:
        for error in report["translation_errors"]:
            field = error["field"]
            if getattr(previous, field):
                setattr(metadata, field, getattr(previous, field))
    field_sources = {field: selection.get("field_sources", {}).get(field, "unknown")
                     if field in protected else result.selected_source for field in EDITABLE_FIELDS}
    translated, originals, fingerprints = [], {}, {}
    for field in ("title", "plot"):
        origin = selection if field in protected else selected
        if field in customized:
            continue
        if field in origin.get("translated_fields", []):
            translated.append(field)
        if field in origin.get("original_fields", {}):
            originals[field] = origin["original_fields"][field]
        if field in origin.get("translation_fingerprints", {}):
            fingerprints[field] = origin["translation_fingerprints"][field]
    selection.update(field_sources=field_sources, translated_fields=translated, original_fields=originals,
        translation_fingerprints=fingerprints)
    request = None
    selection.pop("pending_images", None)
    if metadata.artwork:
        request = {"source": selected["source"], "artwork": selected["metadata"]["artwork"],
                   "missing_only": missing_only, "overwrite_custom": not missing_only}
        selection["pending_images"] = request
    else:
        report["warnings"].append("所选来源无图片" + ("，已保留旧图" if image_manifest(target_folder(output, work.code), work) else ""))
    report["stages"] = {"metadata": "success", "translation": "failed" if report["translation_errors"] else "success",
        "images": "pending" if request else "skipped", "portraits": "pending" if portraits else "skipped"}
    report_progress("metadata")
    with file_transaction(target_folder(output, work.code)):
        write_nfo_files(output, work, serialize_nfo(metadata))
        runtime.record_result(work.code, complete_report({**report, "actor_issues": []}), selection=selection)
    report["images"] = []
    if request:
        report["images"] = await write_artwork(scraper.client, work, output, request, selection)
        report["stages"]["images"] = "failed" if any(r["status"] == "error" for r in report["images"]) else "success"
        runtime.record_result(work.code, complete_report({**report, "actor_issues": []}), selection=selection)
    report["portraits"] = await portraits.save(metadata.actors, kind=actor_type(metadata.classification.category, work.category)) if portraits else []
    report["stages"]["portraits"] = "failed" if any(r["status"] == "error" for r in report["portraits"]) else "success" if portraits else "skipped"
    return complete_report(report)


async def retry_work(scraper, work, output, translator, runtime, portraits, stages):
    metadata = read_nfo(existing_nfo(output, work), work.code)
    selection = runtime.selection(work.code)
    report = {**runtime.results.get(work.code, {}), "code": work.code, "status": "found"}
    report["stages"] = {**report.get("stages", {}), "metadata": "success"}
    if "translation" in stages:
        report_progress("translation")
        failed = {error["field"] for error in report.get("translation_errors", [])}
        originals = selection.get("original_fields", {})
        fields = tuple(field for field in ("title", "plot")
                       if selection.get("field_sources", {}).get(field) != "custom" and originals.get(field)
                       and (field in failed or selection.get("translation_fingerprints", {}).get(field) != translator.fingerprint))
        if fields and not translator.enabled:
            raise ValueError("请先配置并验证翻译服务")
        variant = await translator.variant({"metadata": metadata.model_dump(mode="json"),
            "original_fields": originals, "translated_fields": selection.get("translated_fields", []),
            "translation_fingerprints": selection.get("translation_fingerprints", {}),
            "translation_errors": report.get("translation_errors", [])}, fields=fields)
        updated = Metadata.model_validate(variant["metadata"])
        for error in variant["translation_errors"]:
            field = error["field"]
            if getattr(metadata, field):
                setattr(updated, field, getattr(metadata, field))
        metadata = updated
        report["translation_errors"] = variant["translation_errors"]
        report["stages"]["translation"] = "failed" if variant["translation_errors"] else "success"
        selection.update(translated_fields=variant["translated_fields"], original_fields=variant["original_fields"],
                         translation_fingerprints=variant["translation_fingerprints"])
        with file_transaction(target_folder(output, work.code)):
            write_nfo_files(output, work, serialize_nfo(metadata))
            runtime.record_result(work.code, complete_report(report), selection=selection)
    if "images" in stages:
        request = selection.get("pending_images")
        if not request:
            raise ValueError("缺少待重试的图片输入，请选择图片来源后保存")
        report["images"] = await write_artwork(scraper.client, work, output, request, selection)
        report["stages"]["images"] = "failed" if any(r["status"] == "error" for r in report["images"]) else "success"
        runtime.record_result(work.code, complete_report(report), selection=selection)
    if "portraits" in stages:
        report["portraits"] = await portraits.save(metadata.actors, kind=actor_type(metadata.classification.category, work.category))
        report["stages"]["portraits"] = "failed" if any(r["status"] == "error" for r in report["portraits"]) else "success"
    runtime.save_selection(work.code, selection)
    return complete_report(report)
