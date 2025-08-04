import json
import re
from bs4 import BeautifulSoup

# File paths
html_path = 'test.html'
obj_levels_path = 'object_levels.json'
gameobjects_path = 'gameobjects_final.json'

# Load existing object_levels.json
with open(obj_levels_path, 'r', encoding='utf-8') as f:
    obj_data = json.load(f)

levels = obj_data.get('levels', {})  # keep only levels
# Do not modify obj_data['titles']; leave it as-is

# Parse the HTML file
with open(html_path, 'r', encoding='utf-8') as f:
    soup = BeautifulSoup(f, 'html.parser')

extracted_titles = {}
for anchor in soup.find_all('a', href=True):
    href = anchor['href']
    match = re.search(r'obj_[A-Za-z]+_\d+', href)
    if not match:
        continue

    obj_id = match.group()

    # Update the level
    level_div = anchor.find('div', class_='_count_1tsjb_87')
    if level_div:
        level_text = level_div.get_text(strip=True)
        digits = re.sub(r'\D', '', level_text)
        if digits:
            levels[obj_id] = int(digits)

    # Collect title for use in gameobjects_final.json
    title_div = anchor.find('div', class_='_title_xhvbx_1')
    if title_div:
        extracted_titles[obj_id] = title_div.get_text(strip=True)

# Write updated levels back to object_levels.json (titles remain unchanged)
obj_data['levels'] = levels
with open(obj_levels_path, 'w', encoding='utf-8') as f:
    json.dump(obj_data, f, indent=2, ensure_ascii=False)

# Update the title field in gameobjects_final.json
with open(gameobjects_path, 'r', encoding='utf-8') as f:
    gameobjects = json.load(f)

for obj in gameobjects:
    obj_id = obj.get('id')
    if obj_id in extracted_titles:
        obj['title'] = extracted_titles[obj_id]
        # print(f"Updated title for {obj_id}: {obj['title']}")
    else:
        # Fall back to name if no title is found
        obj['title'] = obj.get('name')

with open(gameobjects_path, 'w', encoding='utf-8') as f:
    json.dump(gameobjects, f, indent=2, ensure_ascii=False)

print("Levels saved to object_levels.json; titles saved to gameobjects_final.json.")
