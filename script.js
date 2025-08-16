// Helper: fetch JSON
async function loadJSON(path) {
  const resp = await fetch(path);
  if (!resp.ok) throw new Error('Failed to load ' + path);
  return resp.json();
}

let objects = [];
// Internally we keep levels as NUMBERS for calculations/UI
let levels = {};
// Derived in runtime from numeric level vs max
let fullyUpgraded = {};
let currentType = 'ALL';
let sortOption = 'none';

// Mapping of type to discount percentage (0-100)
let discountByType = {};

// Global adjustments for aggregated profit and population.
// profitPercent and popPercent are treated as percentage values (100 means 100%, 50 means 50%).
// profitFixed and popFixed are fixed amounts added after the base totals are calculated.
let profitPercent = 100;
let profitFixed = 0;
let popPercent = 100;
let popFixed = 0;

// Constant: value of one key in cost units
const KEY_VALUE = 1250000;

// Keep track of whether to show inactive objects
let showInactive = false;

/** Utility: return max level index for an object (== number of level entries) */
function maxIndexFor(obj) {
  return Array.isArray(obj.levels) ? obj.levels.length : 0;
}

/** Utility: resolve numeric level from a possibly "fullyUpgraded" value */
function resolveNumericLevel(value, maxIndex) {
  if (value === 'fullyUpgraded') return maxIndex;
  let n = parseInt(value, 10);
  if (Number.isNaN(n) || n < 0) n = 0;
  if (n > maxIndex) n = maxIndex;
  return n;
}

/** Utility: when saving, convert numeric to "fullyUpgraded" if at max */
function serializeLevel(numericLevel, maxIndex) {
  return numericLevel >= maxIndex ? 'fullyUpgraded' : numericLevel;
}

// Initial data load
(async function init() {
  let dataLoaded = false;

  // 1) Load game objects
  try {
    const data = await loadJSON('gameobjects_final.json');
    objects = Array.isArray(data) ? data : [];
    dataLoaded = true;
  } catch (err) {
    console.error('Failed to load gameobjects_final.json:', err);
    objects = [];
  }

  // 2) Load levels & settings from object_levels.json (levels may contain numbers OR "fullyUpgraded")
  let rawLevels = {};
  try {
    const loadedData = await loadJSON('object_levels.json');
    if (loadedData && typeof loadedData === 'object') {
      rawLevels = loadedData.levels || {};
      discountByType = loadedData.discounts || {};
      profitPercent = loadedData.profitPercent != null ? loadedData.profitPercent : profitPercent;
      profitFixed = loadedData.profitFixed != null ? loadedData.profitFixed : profitFixed;
      popPercent = loadedData.popPercent != null ? loadedData.popPercent : popPercent;
      popFixed = loadedData.popFixed != null ? loadedData.popFixed : popFixed;
      showInactive = loadedData.showInactive != null ? loadedData.showInactive : showInactive;
    }
  } catch (err) {
    console.warn('Failed to load object_levels.json:', err);
  }

  // 3) Normalize levels -> numeric + derive fullyUpgraded
  levels = {};
  fullyUpgraded = {};

  // Ensure discount keys exist per type
  const allTypes = new Set(objects.map(o => o.type));
  allTypes.forEach(t => {
    if (discountByType[t] == null) discountByType[t] = 0;
  });

  // Build numeric levels map from rawLevels (with support for "fullyUpgraded")
  objects.forEach(o => {
    const maxIdx = maxIndexFor(o);
    const raw = rawLevels[o.id];
    const num = resolveNumericLevel(raw == null ? 0 : raw, maxIdx);
    levels[o.id] = num;
    fullyUpgraded[o.id] = num >= maxIdx;
  });

  // 4) Render UI
  renderDiscountFields();
  renderAdjustmentFields();
  renderBottomTabs();
  renderCards();
  renderStats();

  if (!dataLoaded) {
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
      renderBottomTabs(); // update active state
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

    function computeAdjustedCost(obj, lvl) {
      const nd = lvl < obj.levels.length ? (obj.levels[lvl] || {}) : {};
      let baseCost = nd.cost ?? 0;
      const hasKeysOrStars = (nd.keys_cost ?? 0) > 0 || (nd.stars_cost ?? 0) > 0;
      if ((!baseCost || baseCost === 0) && (nd.keys_cost ?? 0) > 0) {
        baseCost = (nd.keys_cost || 0) * KEY_VALUE;
      }
      const discount = discountByType[obj.type] ?? 0;
      if (baseCost > 0 && !hasKeysOrStars) {
        return baseCost * (1 - discount / 100);
      }
      return baseCost;
    }

    function computeProfit(obj, lvl) {
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
    const dollarRoiA = costA > 0 ? (profitA * 100) / costA : 0;
    const dollarRoiB = costB > 0 ? (profitB * 100) / costB : 0;
    const popA = computePop(a, lvlA);
    const popB = computePop(b, lvlB);
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

// Render cards based on current type and sorting, and active status
function renderCards() {
  const container = document.getElementById('cards');
  container.innerHTML = '';

  // Filter by type and active status
  let filtered = currentType === 'ALL' ? objects : objects.filter(o => o.type === currentType);
  filtered = showInactive ? filtered : filtered.filter(o => o.is_active);

  // Sort according to user preference
  filtered = sortObjects(filtered);

  // Separate groups for ordering: mid-progress, zero-level, maxed
  const midProgress = [];
  const zeroLevel = [];
  const maxed = [];

  filtered.forEach(obj => {
    const lvl = levels[obj.id] ?? 0;
    const maxIdx = maxIndexFor(obj);
    if (lvl === 0) {
      zeroLevel.push(obj);
    } else if (lvl >= maxIdx) {
      maxed.push(obj);
    } else {
      midProgress.push(obj);
    }
  });

  const ordered = [...midProgress, ...zeroLevel, ...maxed];

  ordered.forEach(obj => {
    const card = document.createElement('div');
    card.className = 'card';

    let lvl = levels[obj.id] ?? 0;
    const maxIdx = maxIndexFor(obj);
    if (lvl > maxIdx) lvl = maxIdx;

    fullyUpgraded[obj.id] = lvl >= maxIdx;

    const currData = lvl > 0 ? (obj.levels[lvl - 1] || {}) : {};
    const nextData = lvl < maxIdx ? (obj.levels[lvl] || {}) : {};

    let baseCost = nextData.cost ?? 0;
    const hasKeysOrStars = (nextData.keys_cost ?? 0) > 0 || (nextData.stars_cost ?? 0) > 0;
    if ((!baseCost || baseCost === 0) && (nextData.keys_cost ?? 0) > 0) {
      baseCost = (nextData.keys_cost || 0) * KEY_VALUE;
    }
    const discount = discountByType[obj.type] ?? 0;
    let adjustedCost;
    let discountApplied = false;
    if (baseCost > 0 && !hasKeysOrStars && discount > 0) {
      adjustedCost = baseCost * (1 - discount / 100);
      discountApplied = true;
    } else {
      adjustedCost = baseCost;
    }

    const income = (nextData.income_per_hour ?? 0) - (currData.income_per_hour ?? 0);
    const pop = (nextData.population ?? 0) - (currData.population ?? 0);
    const dollarROI = adjustedCost > 0 ? ((income * 100) / adjustedCost).toFixed(5) : '∞';
    const popROI = adjustedCost > 0 ? ((pop * 100) / adjustedCost).toFixed(5) : '∞';

    let costDisplay;
    if (discountApplied) {
      costDisplay = `<span style="text-decoration: line-through; color:#999;">${baseCost.toLocaleString()}</span> → <span style="color:#d17c00; font-weight:bold;">${adjustedCost.toLocaleString()}</span>`;
    } else {
      costDisplay = adjustedCost ? adjustedCost.toLocaleString() : (baseCost ? baseCost.toLocaleString() : '-') ;
    }

    let marks = '';
    if ((nextData.keys_cost ?? 0) > 0) marks += '<span title="Requires Keys">🔑</span>';
    if ((nextData.stars_cost ?? 0) > 0) marks += '<span title="Requires Stars">⭐</span>';

    if (lvl >= maxIdx) card.classList.add('max-level');
    if (lvl === 0) card.classList.add('zero-level');

    const header = document.createElement('div');
    header.className = 'card-row card-header';
    const info = document.createElement('div');
    info.className = 'card-info';

    const badge = fullyUpgraded[obj.id]
      ? `<span class="badge-fully-upgraded" title="This object is fully upgraded" style="margin-left:8px; padding:2px 6px; border-radius:8px; background:#16a34a; color:#fff; font-size:12px;">Fully upgraded</span>`
      : '';

    info.innerHTML = `<h3>${obj.title || obj.name || obj.id}${badge}</h3><small>Level: ${lvl} | Max: ${maxIdx} | ${obj.id}</small>`;

    const controls = document.createElement('div');
    controls.className = 'level-controls';
    const dec = document.createElement('button');
    dec.textContent = '-';
    dec.onclick = () => updateLevel(obj.id, Math.max(0, lvl - 1));

    const lvlInput = document.createElement('input');
    lvlInput.type = 'number';
    lvlInput.min = '0';
    lvlInput.max = String(maxIdx);
    lvlInput.value = String(lvl);
    lvlInput.style.width = '3rem';
    lvlInput.onchange = () => {
      let val = parseInt(lvlInput.value, 10);
      if (isNaN(val) || val < 0) val = 0;
      if (val > maxIdx) val = maxIdx;
      updateLevel(obj.id, val);
    };

    const inc = document.createElement('button');
    inc.textContent = '+';
    inc.onclick = () => updateLevel(obj.id, Math.min(maxIdx, lvl + 1));

    controls.appendChild(dec);
    controls.appendChild(lvlInput);
    controls.appendChild(inc);

    header.appendChild(info);
    header.appendChild(controls);

    const statsRow = document.createElement('div');
    statsRow.className = 'card-row card-stats';
    statsRow.innerHTML = `<span>Cost: ${costDisplay}${marks}</span><span>Income: ${income.toLocaleString()}</span><span>Population: ${pop.toLocaleString()}</span>`;

    const roiRow = document.createElement('div');
    roiRow.className = 'card-row card-roi';
    roiRow.innerHTML = `<span>$ ROI: ${dollarROI}</span><span>P ROI: ${popROI}</span>`;

    card.appendChild(header);
    card.appendChild(statsRow);
    card.appendChild(roiRow);
    container.appendChild(card);
  });

  renderStats();
}

// Update level and persist locally
function updateLevel(id, newLevel) {
  const obj = objects.find(o => o.id === id);
  if (obj) {
    const maxIdx = maxIndexFor(obj);
    if (newLevel < 0) newLevel = 0;
    if (newLevel > maxIdx) newLevel = maxIdx;
    levels[id] = newLevel;
    fullyUpgraded[id] = newLevel >= maxIdx;
  }
  saveLevelsAndDiscounts();
  renderCards();
  renderStats();
}

/**
 * SAVE current state.
 * IMPORTANT: When exporting "levels", replace any numeric max with the string "fullyUpgraded".
 */
function saveLevelsAndDiscounts() {
  const levelsToSave = {};
  // Iterate over ALL known objects so we can map numeric level -> "fullyUpgraded" at max
  objects.forEach(o => {
    const maxIdx = maxIndexFor(o);
    const numeric = levels[o.id] ?? 0;
    levelsToSave[o.id] = serializeLevel(numeric, maxIdx);
  });

  const dataToSave = {
    levels: levelsToSave,
    discounts: discountByType,
    profitPercent: profitPercent,
    profitFixed: profitFixed,
    popPercent: popPercent,
    popFixed: popFixed,
    showInactive: showInactive
  };

  // Persist to localStorage for session continuity
  try {
    localStorage.setItem('object_levels', JSON.stringify(dataToSave));
    localStorage.setItem('discounts', JSON.stringify(discountByType));
  } catch (err) {
    console.warn('Unable to save to localStorage:', err);
  }
}

// Download current levels/settings as JSON
document.getElementById('download-btn').onclick = () => {
  const levelsToSave = {};
  objects.forEach(o => {
    const maxIdx = maxIndexFor(o);
    const numeric = levels[o.id] ?? 0;
    levelsToSave[o.id] = serializeLevel(numeric, maxIdx);
  });

  const dataToDownload = {
    levels: levelsToSave,
    discounts: discountByType,
    profitPercent: profitPercent,
    profitFixed: profitFixed,
    popPercent: popPercent,
    popFixed: popFixed,
    showInactive: showInactive
  };

  const blob = new Blob([JSON.stringify(dataToDownload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'object_levels.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// Load levels/settings from a user-selected JSON file
document.getElementById('load-btn').onclick = () => {
  document.getElementById('load-levels-input').click();
};

document.getElementById('load-levels-input').onchange = (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const loadedData = JSON.parse(e.target.result);
      if (typeof loadedData !== 'object' || loadedData === null || !loadedData.levels || !loadedData.discounts) {
        alert('Invalid file format. Please select a file with levels and discounts.');
        return;
      }

      // Read raw levels (numbers or "fullyUpgraded") and normalize to numeric internally
      const rawLevels = loadedData.levels || {};
      discountByType = loadedData.discounts || {};
      profitPercent = loadedData.profitPercent != null ? loadedData.profitPercent : profitPercent;
      profitFixed = loadedData.profitFixed != null ? loadedData.profitFixed : profitFixed;
      popPercent = loadedData.popPercent != null ? loadedData.popPercent : popPercent;
      popFixed = loadedData.popFixed != null ? loadedData.popFixed : popFixed;
      if (loadedData.showInactive != null) showInactive = loadedData.showInactive;

      // Normalize numeric levels and fullyUpgraded flags
      levels = {};
      fullyUpgraded = {};
      objects.forEach(o => {
        const maxIdx = maxIndexFor(o);
        const raw = rawLevels[o.id];
        const num = resolveNumericLevel(raw == null ? 0 : raw, maxIdx);
        levels[o.id] = num;
        fullyUpgraded[o.id] = num >= maxIdx;
      });

      // Ensure discounts exist for all known types
      const types = new Set(objects.map(o => o.type));
      types.forEach(t => { if (discountByType[t] == null) discountByType[t] = 0; });

      // Update UI
      document.getElementById('show-inactive-checkbox').checked = showInactive;
      renderDiscountFields();
      renderAdjustmentFields();
      renderCards();
      renderStats();

      // Sync to localStorage in the new format (levels with "fullyUpgraded" on max)
      const levelsToSave = {};
      objects.forEach(o => {
        const maxIdx = maxIndexFor(o);
        const numeric = levels[o.id] ?? 0;
        levelsToSave[o.id] = serializeLevel(numeric, maxIdx);
      });
      localStorage.setItem('object_levels', JSON.stringify({
        levels: levelsToSave,
        discounts: discountByType,
        profitPercent,
        profitFixed,
        popPercent,
        popFixed,
        showInactive
      }));
      localStorage.setItem('discounts', JSON.stringify(discountByType));

      alert('Levels, discounts, and settings loaded successfully!');
    } catch (err) {
      alert('Error reading or parsing file.');
      console.error(err);
    }
  };
  reader.readAsText(file);
  event.target.value = ''; // allow re-uploading the same file
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
      saveLevelsAndDiscounts();
      renderCards();
      renderStats();
    };
    wrapper.appendChild(label);
    wrapper.appendChild(input);
    container.appendChild(wrapper);
  });
}

// Populate adjustment settings fields for profit and population
function renderAdjustmentFields() {
  const container = document.getElementById('adjust-fields');
  if (!container) return;
  container.innerHTML = '';

  function addField(labelText, valueGetter, valueSetter, options = {}) {
    const wrapper = document.createElement('div');
    const label = document.createElement('label');
    label.textContent = `${labelText}: `;
    const input = document.createElement('input');
    input.type = 'number';
    if (options.min != null) input.min = String(options.min);
    if (options.max != null) input.max = String(options.max);
    if (options.step != null) input.step = String(options.step);
    input.value = String(valueGetter());
    input.style.width = '70px';
    input.oninput = () => {
      let val = parseFloat(input.value);
      if (isNaN(val)) val = 0;
      if (options.max != null && val > options.max) val = options.max;
      if (options.min != null && val < options.min) val = options.min;
      valueSetter(val);
      saveLevelsAndDiscounts();
      renderStats();
    };
    wrapper.appendChild(label);
    wrapper.appendChild(input);
    container.appendChild(wrapper);
  }

  addField('Profit percent (%)', () => profitPercent, (val) => { profitPercent = val; }, { min: 0 });
  addField('Profit fixed', () => profitFixed, (val) => { profitFixed = val; });
  addField('Population percent (%)', () => popPercent, (val) => { popPercent = val; }, { min: 0 });
  addField('Population fixed', () => popFixed, (val) => { popFixed = val; });
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
  const filteredByType = currentType === 'ALL'
    ? objects
    : objects.filter(o => o.type === currentType);
  const relevantObjects = showInactive
    ? filteredByType
    : filteredByType.filter(o => o.is_active);

  let totalProfit = 0;
  let totalPop = 0;

  relevantObjects.forEach(obj => {
    const lvl = levels[obj.id] ?? 0;
    const curr = lvl > 0 ? (obj.levels[lvl - 1] || {}) : {};
    totalProfit += (curr.income_per_hour ?? 0);
    totalPop += (curr.population ?? 0);
  });

  const bar = document.getElementById('stats-bar');
  const totalCards = relevantObjects.length;

  const profitPercentValue = (totalProfit * (profitPercent / 100));
  const totalProfitAdjusted = profitFixed + profitPercentValue;
  const popPercentValue = (totalPop * (popPercent / 100));
  const totalPopAdjusted = popFixed + popPercentValue;

  bar.textContent =
    `Total Cards: ${totalCards} | ` +
    `Total Profit: ${totalProfitAdjusted.toLocaleString()} | ` +
    `Total Population: ${totalPopAdjusted.toLocaleString()}`;
}

// Show/hide inactive checkbox
document.getElementById('show-inactive-checkbox').onchange = (e) => {
  showInactive = e.target.checked;
  saveLevelsAndDiscounts();
  renderCards();
};

// Initial render to ensure UI binds are in place if init fails early
renderCards();
