"""Japanese primary names with conservative alias lookup; no online actor scraping."""

from __future__ import annotations

import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path


def comparison_name(name: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", name).strip()).casefold()


class ActorAliases:
    def __init__(self, actors: dict[str, dict]):
        if not isinstance(actors, dict):
            raise ValueError("actor mapping must contain an actors object")
        for name, record in actors.items():
            if (
                not isinstance(name, str)
                or not name.strip()
                or not isinstance(record, dict)
                or any(
                    not isinstance(record.get(field), list)
                    or any(not isinstance(v, str) for v in record[field])
                    for field in ("aliases", "homepages")
                )
            ):
                raise ValueError(
                    "actor mapping requires primary names, aliases and homepages string lists"
                )
        self.actors = actors
        owners: dict[str, set[str]] = {}
        for name, record in actors.items():
            for alias in [name, *record["aliases"]]:
                owners.setdefault(comparison_name(alias), set()).add(name)
        self.aliases = {
            alias: next(iter(names)) for alias, names in owners.items() if len(names) == 1
        }
        self.ambiguous = {alias: sorted(names) for alias, names in owners.items() if len(names) > 1}

    @classmethod
    def load(cls, path: Path | None = None) -> ActorAliases:
        target = path or Path(__file__).parent / "data/actor_aliases.json"
        stamp = target.stat()
        return cls._load(target, (stamp.st_mtime_ns, stamp.st_ctime_ns, stamp.st_size))

    @classmethod
    @lru_cache(maxsize=4)
    def _load(cls, path, stamp):
        value = path.read_text(encoding="utf-8")
        document = json.loads(value)
        if (
            not isinstance(document, dict)
            or document.get("version") != 1
            or "actors" not in document
        ):
            raise ValueError("unsupported actor mapping schema")
        return cls(document["actors"])

    def resolve(self, name: str) -> str | None:
        """Return a Japanese primary name only when identity is unambiguous."""
        key = comparison_name(name)
        if key in self.ambiguous:
            return None
        if key in self.aliases:
            return self.aliases[key]
        if match := re.fullmatch(r"(.+?)\(([^()]+)\)", key):
            parts = [comparison_name(part) for part in match.groups()]
            if all(part in self.aliases for part in parts):
                candidates = {self.aliases[part] for part in parts}
                if len(candidates) == 1:
                    return next(iter(candidates))
                self.ambiguous[key] = sorted(candidates)
        return None

    def pending(self, issues: dict[str, dict]) -> dict[str, dict]:
        pending = {}
        for name, issue in issues.items():
            if self.resolve(name) is None and (
                candidates := self.ambiguous.get(comparison_name(name), [])
            ):
                pending[name] = {**issue, "status": "ambiguous", "candidates": candidates}
        return pending


def library_actors(works, output: Path, names: ActorAliases, query: str = "") -> list[dict]:
    from .images import actor_image
    from .nfo import existing_nfo, read_nfo

    folder = output.resolve() / "actors"
    image_index = {}
    if folder.is_dir() and not folder.is_symlink():
        for image in folder.iterdir():
            if image.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".gif"} and image.is_file() and not image.is_symlink():
                image_index.setdefault(image.stem, image)
    invalid_names = set()
    portraits = {}

    def portrait(name):
        if name not in portraits:
            try:
                portraits[name] = actor_image(output, name, index=image_index)
            except ValueError:
                invalid_names.add(name)
                portraits[name] = None
        return portraits[name]

    rows = {}
    for work in works:
        try:
            metadata = read_nfo(existing_nfo(output, work), work.code)
        except (ValueError, OSError):
            continue
        for actor in metadata.actors:
            row = rows.setdefault(
                actor.name, {"actors": [actor.name], "codes": set(), "eligible": True}
            )
            row["codes"].add(work.code)

    needle = comparison_name(query)
    matched = {}
    if needle:
        for primary, record in names.actors.items():
            if any(needle in comparison_name(value) for value in [primary, *record["aliases"]]):
                matched[primary] = {"actors": [], "codes": set(), "eligible": True}
    for name, row in rows.items():
        primary = (names.resolve(name) or name) if needle and row["eligible"] else name
        if needle and primary not in matched and needle not in comparison_name(name):
            continue
        target = matched.setdefault(primary, {"actors": [], "codes": set(), "eligible": True})
        target["actors"].append(name)
        target["codes"].update(row["codes"])

    result = []
    for name, row in matched.items():
        resolved = names.resolve(name) if row["eligible"] else None
        candidates = names.ambiguous.get(comparison_name(name), []) if row["eligible"] else []
        portrait_name = next((actual for actual in row["actors"] if portrait(actual)), None)
        if not row["actors"] and portrait(name):
            portrait_name = name
        image = portrait(portrait_name) if portrait_name else None
        try:
            version = image.stat() if image else None
        except FileNotFoundError:
            version = None
        result.append(
            {
                "name": name,
                "actors": row["actors"],
                "portrait_name": portrait_name or next(iter(row["actors"]), name),
                "codes": sorted(row["codes"]),
                "count": len(row["codes"]),
                "portrait": version is not None,
                "portrait_status": "ready" if version else "missing",
                "portrait_version": f"{version.st_mtime_ns}-{version.st_size}" if version else None,
                "portrait_eligible": row["eligible"]
                and not candidates
                and not invalid_names.intersection(row["actors"] or [name]),
                "status": "ambiguous" if candidates else "known" if resolved else "original",
                "candidates": candidates,
            }
        )
    return sorted(result, key=lambda row: (-row["count"], not row["portrait"], row["name"]))
