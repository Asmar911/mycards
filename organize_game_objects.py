import json
from typing import List, Dict, Any


def organize_game_objects(input_path: str, output_path: str) -> None:
    """Read game objects from a decoded JSON file and save summary with level data."""
    with open(input_path, "r", encoding="utf-8") as f:
        data: List[List[Dict[str, Any]]] = json.load(f)

    result = []
    for group in data:
        if not group:
            continue
        first = group[0]
        obj_id = first.get("id")
        name = first.get("name_en") or first.get("name_ru") or first.get("name_zh")
        obj_type = first.get("type")
        is_active = first.get("is_active", False)
        title = ""

        level_entries = []
        for item in sorted(group, key=lambda x: x.get("level", 0)):
            level_entries.append(
                {
                    "level": item.get("level"),
                    "cost": item.get("cost"),
                    "income_per_hour": item.get("income_per_hour"),
                    "population": item.get("population"),
                    "keys_cost": item.get("keys_cost"),
                    "stars_cost": item.get("stars_cost"),
                }
            )

        result.append({"id": obj_id, "name": name,"type":obj_type,"is_active":is_active,"title": title,"levels": level_entries})

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    organize_game_objects("gameobjects_decoded.json", "gameobjects_final.json")

