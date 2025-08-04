import json
from typing import List, Dict, Any
from datetime import datetime
import pytz


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

        result.append(
            {
                "id": obj_id,
                "name": name,
                "type": obj_type,
                "is_active": is_active,
                "title": title,
                "levels": level_entries,
            }
        )

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"Game objects organized and saved to {output_path}")


# def organize_quizzes(input_path: str, output_path: str) -> None:
#     with open(input_path, "r", encoding="utf-8") as f:
#         quizzes = json.load(f)

#     istanbul_tz = pytz.timezone("Europe/Istanbul")
#     quizzes_sorted = sorted(quizzes, key=lambda x: x.get("start_at", 0))

#     transformed = []
#     for quiz in quizzes_sorted:
#         quiz_id = quiz.get("id")
#         start_at_ts = quiz.get("start_at")

#         if start_at_ts:
#             dt = datetime.fromtimestamp(start_at_ts, tz=pytz.utc).astimezone(istanbul_tz)
#             start_at_str = dt.strftime("%d/%m/%Y")
#         else:
#             start_at_str = ""

#         questions_map = {}
#         for question in quiz.get("questions", []):
#             level = question.get("level")
#             correct_answer_index = None
#             # Find the index of the correct answer (1-based)
#             for idx, answer in enumerate(question.get("answers", []), start=1):
#                 if answer.get("is_right") is True:
#                     correct_answer_index = idx
#                     break
#             if level is not None and correct_answer_index is not None:
#                 questions_map[str(level)] = correct_answer_index  # store as integer

#         transformed.append({
#             "id": quiz_id,
#             "start_at": start_at_str,
#             "questions": questions_map,
#         })

#     with open(output_path, "w", encoding="utf-8") as f:
#         json.dump(transformed, f, indent=2, ensure_ascii=False)


if __name__ == "__main__":
    organize_game_objects("gameobjects_decoded.json", "gameobjects_final.json")
    # organize_quizzes("gamequizzes_decoded.json", "gamequizzes_final.json")
