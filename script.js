// Helper: fetch JSON
async function loadJSON(path) {
  const resp = await fetch(path);
  if (!resp.ok) throw new Error('Failed to load ' + path);
  return resp.json();
}

let objects = [];
let levels = {};
let currentType = 'ALL';
let sortOption = 'none';
// Mapping of type to discount percentage (0-100)
let discountByType = {};
// Constant: value of one key in cost units
const KEY_VALUE = 1250000;

// Initial data load
(async function init() {
  let dataLoaded = false;
  // Try to load gameobjects
  try {
    const data = await loadJSON('gameobjects_final.json');
    objects = Array.isArray(data) ? data.filter(obj => obj.is_active) : [];
    dataLoaded = true;
  } catch (err) {
    console.error('Failed to load gameobjects_final.json:', err);
    objects = [];
  }
  // Try to load levels
  try {
    levels = await loadJSON('object_levels.json');
  } catch {
    levels = {};
  }
  // ensure all objects have an entry
  objects.forEach(o => {
    if (levels[o.id] == null) levels[o.id] = 0;
    // Clamp loaded level values within allowed range
    const maxIndex = o.levels.length;
    if (levels[o.id] > maxIndex) levels[o.id] = maxIndex;
    if (levels[o.id] < 0) levels[o.id] = 0;
  });
  // Initialize discounts: load from localStorage if present
  const stored = localStorage.getItem('discounts');
  if (stored) {
    try { discountByType = JSON.parse(stored); } catch { discountByType = {}; }
  }
  // Ensure discount keys exist for each type
  objects.forEach(o => { if (discountByType[o.type] == null) discountByType[o.type] = 0; });
  // Render UI elements regardless of data loaded
  renderDiscountFields();
  renderBottomTabs();
  renderCards();
  renderStats();
  if (!dataLoaded) {
    // show message when data couldn't load
    const cardsDiv = document.getElementById('cards');
    cardsDiv.innerHTML = '<p style="padding:1rem;color:#666;">Failed to load game objects. Please ensure the JSON files are served over HTTP.</p>';
  }
})();

// Render bottom filter bar
function renderBottomTabs() {
  const bar = document.getElementById('bottom-tabs');
  const types = Array.from(new Set(objects.map(o => o.type)));
  bar.innerHTML = '';
  const createButton = (label, typeValue) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    if (currentType === typeValue) btn.classList.add('active');
    btn.onclick = () => {
      currentType = typeValue;
      renderCards();
      renderBottomTabs();
    };
    bar.appendChild(btn);
  };
  createButton('All', 'ALL');
  types.forEach(t => createButton(t, t));
}

// Sorting helper
function sortObjects(list) {
  const sorted = [...list];
  sorted.sort((a, b) => {
    const lvlA = levels[a.id] ?? 0;
    const lvlB = levels[b.id] ?? 0;
    // Compute base cost for each object and level, converting keys to cost and applying discounts
    function computeAdjustedCost(obj, lvl) {
      // Cost for the next level (upgrade from current lvl to lvl+1)
      const nd = lvl < obj.levels.length ? (obj.levels[lvl] || {}) : {};
      let baseCost = nd.cost ?? 0;
      if ((!baseCost || baseCost === 0) && (nd.keys_cost ?? 0) > 0) {
        baseCost = (nd.keys_cost || 0) * KEY_VALUE;
      }
      const discount = discountByType[obj.type] ?? 0;
      return baseCost > 0 ? baseCost * (1 - discount / 100) : 0;
    }
    function computeProfit(obj, lvl) {
      // incremental profit for next level (next - current)
      const curr = lvl > 0 ? (obj.levels[lvl - 1] || {}) : {};
      const next = lvl < obj.levels.length ? (obj.levels[lvl] || {}) : {};
      return (next.income_per_hour ?? 0) - (curr.income_per_hour ?? 0);
    }
    function computePop(obj, lvl) {
      const curr = lvl > 0 ? (obj.levels[lvl - 1] || {}) : {};
      const next = lvl < obj.levels.length ? (obj.levels[lvl] || {}) : {};
      return (next.population ?? 0) - (curr.population ?? 0);
    }
    const costA = computeAdjustedCost(a, lvlA);
    const costB = computeAdjustedCost(b, lvlB);
    const profitA = computeProfit(a, lvlA);
    const profitB = computeProfit(b, lvlB);
    const popA = computePop(a, lvlA);
    const popB = computePop(b, lvlB);
    const dollarRoiA = costA > 0 ? (profitA * 100) / costA : 0;
    const dollarRoiB = costB > 0 ? (profitB * 100) / costB : 0;
    const popRoiA = costA > 0 ? (popA * 100) / costA : 0;
    const popRoiB = costB > 0 ? (popB * 100) / costB : 0;
    switch (sortOption) {
      case 'level-low-high': return (levels[a.id] ?? 0) - (levels[b.id] ?? 0);
      case 'level-high-low': return (levels[b.id] ?? 0) - (levels[a.id] ?? 0);
      case 'price-high-low': return costB - costA;
      case 'price-low-high': return costA - costB;
      case 'profit-high-low': return profitB - profitA;
      case 'profit-low-high': return profitA - profitB;
      case 'dollar-roi-high-low': return dollarRoiB - dollarRoiA;
      case 'dollar-roi-low-high': return dollarRoiA - dollarRoiB;
      case 'population-roi-high-low': return popRoiB - popRoiA;
      case 'population-roi-low-high': return popRoiA - popRoiB;
      default: return 0;
    }
  });
  return sorted;
}

document.getElementById('sort-select').onchange = (e) => {
  sortOption = e.target.value;
  renderCards();
};

// Render cards based on current type and sorting
function renderCards() {
  const container = document.getElementById('cards');
  container.innerHTML = '';
  let filtered = currentType === 'ALL' ? objects : objects.filter(o => o.type === currentType);
  // Sort according to user preference
  filtered = sortObjects(filtered);
  // Separate cards that have reached maximum level; they will be displayed last
  const nonMax = [];
  const maxed = [];
  filtered.forEach(obj => {
    const lvl = levels[obj.id] ?? 0;
    const maxIndex = obj.levels.length;
    if (lvl >= maxIndex) {
      maxed.push(obj);
    } else {
      nonMax.push(obj);
    }
  });
  const ordered = [...nonMax, ...maxed];
  ordered.forEach(obj => {
    const card = document.createElement('div');
    card.className = 'card';
    // current level index (0..maxIndex)
    let lvl = levels[obj.id] ?? 0;
    const maxIndex = obj.levels.length;
    if (lvl > maxIndex) lvl = maxIndex;
    // current and previous data using one-based indexing
    const currData = lvl > 0 ? (obj.levels[lvl - 1] || {}) : {};
    const prevData = lvl > 1 ? (obj.levels[lvl - 2] || {}) : {};
    // next level data used for upgrade cost and growth (if available)
    const nextData = lvl < maxIndex ? (obj.levels[lvl] || {}) : {};
    // base cost for next level and discount
    let baseCost = nextData.cost ?? 0;
    if ((!baseCost || baseCost === 0) && (nextData.keys_cost ?? 0) > 0) {
      baseCost = (nextData.keys_cost || 0) * KEY_VALUE;
    }
    const discount = discountByType[obj.type] ?? 0;
    const adjustedCost = baseCost > 0 ? (baseCost * (1 - discount / 100)) : 0;
    // incremental profit and population for next level (growth)
    const income = (nextData.income_per_hour ?? 0) - (currData.income_per_hour ?? 0);
    const pop = (nextData.population ?? 0) - (currData.population ?? 0);
    const dollarROI = adjustedCost > 0 ? ((income * 100) / adjustedCost).toFixed(2) : '∞';
    const popROI = adjustedCost > 0 ? ((pop * 100) / adjustedCost).toFixed(2) : '∞';
    // cost display with discount coloring
    let costDisplay;
    if (discount > 0 && baseCost > 0) {
      costDisplay = `<span style="text-decoration: line-through; color:#999;">${baseCost.toLocaleString()}</span> → <span style="color:#d17c00; font-weight:bold;">${adjustedCost.toLocaleString()}</span>`;
    } else {
      costDisplay = adjustedCost ? adjustedCost.toLocaleString() : (baseCost ? baseCost.toLocaleString() : '-') ;
    }
    // marks for keys and stars based on next level requirements
    let marks = '';
    if ((nextData.keys_cost ?? 0) > 0) {
      marks += ' <span title="Requires Keys" style="color:#e69b00;">🔑</span>';
    }
    if ((nextData.stars_cost ?? 0) > 0) {
      marks += ' <span title="Requires Stars" style="color:#e69b00;">⭐</span>';
    }
    // Apply special styling if at max level
    if (lvl >= maxIndex) {
      card.classList.add('max-level');
    }
    // Header row: name, ID, level controls
    const header = document.createElement('div');
    header.className = 'card-row card-header';
    const info = document.createElement('div');
    info.className = 'card-info';
    info.innerHTML = `<h3>${obj.name || obj.id}</h3><small>ID: ${obj.id}</small>`;
    // Level controls
    const controls = document.createElement('div');
    controls.className = 'level-controls';
    const dec = document.createElement('button');
    dec.textContent = '-';
    dec.onclick = () => updateLevel(obj.id, Math.max(0, lvl - 1));
    const lvlInput = document.createElement('input');
    lvlInput.type = 'number';
    lvlInput.min = '0';
    lvlInput.max = String(maxIndex);
    lvlInput.value = String(lvl);
    lvlInput.style.width = '3rem';
    lvlInput.onchange = () => {
      let val = parseInt(lvlInput.value);
      if (isNaN(val) || val < 0) val = 0;
      if (val > maxIndex) val = maxIndex;
      updateLevel(obj.id, val);
    };
    const inc = document.createElement('button');
    inc.textContent = '+';
    inc.onclick = () => updateLevel(obj.id, Math.min(maxIndex, lvl + 1));
    controls.appendChild(dec);
    controls.appendChild(lvlInput);
    controls.appendChild(inc);
    header.appendChild(info);
    header.appendChild(controls);
    // Stats row: cost, income, population
    const statsRow = document.createElement('div');
    statsRow.className = 'card-row card-stats';
    statsRow.innerHTML = `<span>Cost: ${costDisplay}${marks}</span><span>Income/hour: ${income}</span><span>Population: ${pop}</span>`;
    // ROI row
    const roiRow = document.createElement('div');
    roiRow.className = 'card-row card-roi';
    roiRow.innerHTML = `<span>$ ROI: ${dollarROI}</span><span>P ROI: ${popROI}</span>`;
    // assemble card
    card.appendChild(header);
    card.appendChild(statsRow);
    card.appendChild(roiRow);
    container.appendChild(card);
  });
  // update stats whenever cards are rendered
  renderStats();
}

// Update level and persist locally
function updateLevel(id, newLevel) {
  // Clamp newLevel within valid range based on the object's number of upgrade levels
  const obj = objects.find(o => o.id === id);
  if (obj) {
    const maxIndex = obj.levels.length;
    if (newLevel < 0) newLevel = 0;
    if (newLevel > maxIndex) newLevel = maxIndex;
  }
  levels[id] = newLevel;
  localStorage.setItem('object_levels', JSON.stringify(levels));
  renderCards();
  renderStats();
}

// Download current levels as JSON when user clicks the save button
document.getElementById('download-btn').onclick = () => {
  const blob = new Blob([JSON.stringify(levels, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'object_levels.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// Load levels from a user-selected JSON file
document.getElementById('load-btn').onclick = () => {
  document.getElementById('load-levels-input').click();
};

document.getElementById('load-levels-input').onchange = (event) => {
  const file = event.target.files[0];
  if (!file) {
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const loadedLevels = JSON.parse(e.target.result);
      // Basic validation to ensure it's a plausible levels file
      if (typeof loadedLevels === 'object' && loadedLevels !== null) {
        levels = loadedLevels;
        // Re-clamp level values after loading
        objects.forEach(o => {
          if (levels[o.id] == null) levels[o.id] = 0;
          const maxIndex = o.levels.length;
          if (levels[o.id] > maxIndex) levels[o.id] = maxIndex;
          if (levels[o.id] < 0) levels[o.id] = 0;
        });
        localStorage.setItem('object_levels', JSON.stringify(levels));
        renderCards();
        renderStats();
        alert('Levels loaded successfully!');
      } else {
        alert('Invalid file format.');
      }
    } catch (err) {
      alert('Error reading or parsing file.');
      console.error(err);
    }
  };
  reader.readAsText(file);
  // Reset file input so the same file can be loaded again
  event.target.value = '';
};

// Populate discount settings fields
function renderDiscountFields() {
  const container = document.getElementById('discount-fields');
  container.innerHTML = '';
  const types = Array.from(new Set(objects.map(o => o.type)));
  types.forEach(type => {
    const wrapper = document.createElement('div');
    const label = document.createElement('label');
    label.textContent = `${type} discount (%): `;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '100';
    input.value = discountByType[type] ?? 0;
    input.style.width = '70px';
    input.oninput = () => {
      let val = parseFloat(input.value);
      if (isNaN(val) || val < 0) val = 0;
      if (val > 100) val = 100;
      discountByType[type] = val;
      // persist discounts to localStorage
      localStorage.setItem('discounts', JSON.stringify(discountByType));
      renderCards();
      renderStats();
    };
    wrapper.appendChild(label);
    wrapper.appendChild(input);
    container.appendChild(wrapper);
  });
}

// Toggle settings panel
document.getElementById('settings-btn').onclick = () => {
  const panel = document.getElementById('settings-panel');
  if (panel.style.display === 'none' || panel.style.display === '') {
    panel.style.display = 'block';
  } else {
    panel.style.display = 'none';
  }
};

// Compute and render total cross profit and population across all objects at their current levels
function renderStats() {
  let totalProfit = 0;
  let totalPop = 0;
  /*
   * Cross metrics should accumulate values across levels 1 through the
   * current level. Level index 0 represents the base state and
   * therefore contributes no cross profit or population. When all
   * cards are at level 0, the totals should be zero.
   */
  objects.forEach(obj => {
    // For the current level of each object, calculate the incremental profit and
    // population relative to the previous level using one-based indexing of
    // upgrade levels (level 0 has no stats). For lvl = 0 the deltas are zero.
    const lvl = levels[obj.id] ?? 0;
    // current upgrade stats reside at index lvl-1 in obj.levels
    const curr = lvl > 0 ? (obj.levels[lvl - 1] || {}) : {};
    const prev = lvl > 1 ? (obj.levels[lvl - 2] || {}) : {};
    totalProfit += (curr.income_per_hour ?? 0) - (prev.income_per_hour ?? 0);
    totalPop += (curr.population ?? 0) - (prev.population ?? 0);
  });
  const bar = document.getElementById('stats-bar');
  bar.textContent = `Total Cross Profit: ${totalProfit.toLocaleString()} | Total Cross Population: ${totalPop.toLocaleString()}`;
}
