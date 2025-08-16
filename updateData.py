import json
import re
from pathlib import Path

from bs4 import BeautifulSoup, SoupStrainer

# === Config (adjust paths if needed) ===
HTML_PATH = Path("test.html")
OBJ_LEVELS_PATH = Path("object_levels.json")
GAMEOBJECTS_PATH = Path("gameobjects_final.json")

FULLY_UP_STR = "fullyUpgraded"
FULLY_MARKERS = ("fully upgraded", "object constructed")

OBJ_ID_RE = re.compile(r"(obj_[a-z]+_\d+)", re.IGNORECASE)

def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")

def has_fully_marker(anchor) -> bool:
    classes = anchor.get("class") or []
    if any("_isCompleted_" in c for c in classes):
        return True
    text = anchor.get_text(separator=" ", strip=True).lower()
    return any(m in text for m in FULLY_MARKERS)

def extract_obj_id(href: str) -> str | None:
    if not href:
        return None
    m = OBJ_ID_RE.search(href)
    return m.group(1) if m else None

def extract_level(anchor) -> int | None:
    node = anchor.find(True, class_=re.compile(r"_count_"))
    if not node:
        return None
    txt = node.get_text(strip=True)
    digits = re.sub(r"\D", "", txt)
    if not digits:
        return None
    try:
        return int(digits)
    except ValueError:
        return None

def extract_title(anchor) -> str | None:
    title_div = anchor.find(True, class_=re.compile(r"_title_"))
    return title_div.get_text(strip=True) if title_div else None

def parse_html_for_levels_and_titles(html: str):
    levels_map = {}
    titles_map = {}

    soup = BeautifulSoup(html, "html.parser", parse_only=SoupStrainer("a"))
    for a in soup:
        if not hasattr(a, "get"):
            continue

        obj_id = extract_obj_id(a.get("href", ""))
        if not obj_id:
            continue

        title = extract_title(a)
        if title:
            titles_map[obj_id] = title

        if has_fully_marker(a):
            levels_map[obj_id] = FULLY_UP_STR
            continue

        lvl = extract_level(a)
        if lvl is not None:
            levels_map[obj_id] = lvl

    return levels_map, titles_map

def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)

def save_json(path: Path, data: dict):
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def main():
    if not HTML_PATH.exists():
        raise FileNotFoundError(f"{HTML_PATH} not found")

    html = read_text(HTML_PATH)
    new_levels, new_titles = parse_html_for_levels_and_titles(html)

    # --- Update object_levels.json (merge) ---
    obj_data = load_json(OBJ_LEVELS_PATH)
    levels = obj_data.get("levels", {})
    for k, v in new_levels.items():
        levels[k] = v

    # 🔹 Sort levels by object ID
    sorted_levels = {k: levels[k] for k in sorted(levels.keys())}
    obj_data["levels"] = sorted_levels

    save_json(OBJ_LEVELS_PATH, obj_data)
    print(f"Updated {OBJ_LEVELS_PATH} with {len(new_levels)} level entries (sorted by ID).")

    # --- Update titles in gameobjects_final.json (if present) ---
    if GAMEOBJECTS_PATH.exists():
        gameobjects = load_json(GAMEOBJECTS_PATH)
        changed = 0
        if isinstance(gameobjects, list):
            for obj in gameobjects:
                oid = obj.get("id")
                if not oid:
                    continue
                if oid in new_titles:
                    obj["title"] = new_titles[oid]
                    changed += 1
                elif "name" in obj and "title" not in obj:
                    obj["title"] = obj["name"]
        save_json(GAMEOBJECTS_PATH, gameobjects)
        print(f"Updated titles for {changed} objects in {GAMEOBJECTS_PATH}.")
    else:
        print(f"{GAMEOBJECTS_PATH} not found; skipped title sync.")

if __name__ == "__main__":
    main()
