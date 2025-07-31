import json

# Paths to the JSON files
obj_levels_path = 'object_levels_new.json'
gameobjects_path = 'gameobjects_final.json'

# Load the titles mapping from object_levels_new.json
with open(obj_levels_path, 'r', encoding='utf-8') as f:
    obj_levels_data = json.load(f)

titles_mapping = obj_levels_data.get('titles', {})

# Load the game objects
with open(gameobjects_path, 'r', encoding='utf-8') as f:
    gameobjects = json.load(f)

# Insert the title into each game object using its id as the key
for obj in gameobjects:
    obj_id = obj.get('id')
    if obj_id in titles_mapping:
        obj['title'] = titles_mapping[obj_id]
    else:
        # If no title found for this id, you can assign None or a default value
        obj['title'] = None

# Save the updated game objects back to disk
with open(gameobjects_path, 'w', encoding='utf-8') as f:
    json.dump(gameobjects, f, indent=2, ensure_ascii=False)

print("Titles have been added to gameobjects_final.json.")
