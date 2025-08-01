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

// Initial data load
(async function init() {
  let dataLoaded = false;
    // Try to load gameobjects
    try {
    const data = await loadJSON('gameobjects_final.json');
    /*
     * Do not filter objects by their active status during initial load.  The
     * `showInactive` toggle should determine which cards are visible in
     * `renderCards()`.  Filtering here permanently discards inactive
     * objects and prevents them from ever being shown when the user
     * enables the "show inactive" option.
     */
    objects = Array.isArray(data) ? data : [];
    dataLoaded = true;
  } catch (err) {
    console.error('Failed to load gameobjects_final.json:', err);
    objects = [];
  }
  // Try to load levels and discounts from object_levels.json
  try {
    const loadedData = await loadJSON('object_levels.json');
    if (loadedData && typeof loadedData === 'object') {
      levels = loadedData.levels || {};
      discountByType = loadedData.discounts || {};
      // Load adjustment settings if present; default values otherwise
      profitPercent = loadedData.profitPercent != null ? loadedData.profitPercent : profitPercent;
      profitFixed = loadedData.profitFixed != null ? loadedData.profitFixed : profitFixed;
      popPercent = loadedData.popPercent != null ? loadedData.popPercent : popPercent;
      popFixed = loadedData.popFixed != null ? loadedData.popFixed : popFixed;
      showInactive = loadedData.showInactive != null ? loadedData.showInactive : showInactive;          
    } else {
      levels = {};
      discountByType = {};
      // adjustments remain at default values
    }
  } catch(err) {
      console.warn('Failed to load object_levels.json:', err);
      levels = {};
      discountByType = {};
  }

  // ensure all objects have an entry and clamp levels
  objects.forEach(o => {
    if (levels[o.id] == null) levels[o.id] = 0;
    // Clamp loaded level values within allowed range
    const maxIndex = o.levels.length;
    if (levels[o.id] > maxIndex) levels[o.id] = maxIndex;
    if (levels[o.id] < 0) levels[o.id] = 0;

    // Ensure discount keys exist for each type
    if (discountByType[o.type] == null) discountByType[o.type] = 0;
  });

  // Render UI elements regardless of data loaded
  renderDiscountFields();
  renderAdjustmentFields();
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
      renderBottomTabs(); // re-render tabs to update active state
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
      // Determine whether the next level requires keys or stars
      const hasKeysOrStars = (nd.keys_cost ?? 0) > 0 || (nd.stars_cost ?? 0) > 0;
      // If no monetary cost but there are keys required, convert keys to monetary cost
      if ((!baseCost || baseCost === 0) && (nd.keys_cost ?? 0) > 0) {
        baseCost = (nd.keys_cost || 0) * KEY_VALUE;
      }
      const discount = discountByType[obj.type] ?? 0;
      // Apply discount only when base cost exists and the level is purely cost based (no keys or stars requirement)
      if (baseCost > 0 && !hasKeysOrStars) {
        return baseCost * (1 - discount / 100);
      }
      return baseCost;
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
  // Separate cards into groups: active upgrades, zero-level, and fully upgraded.
  // Cards with current level equal to 0 or at max level should be placed at the bottom
  // so that mid‑progress cards are shown first.
  const midProgress = [];
  const zeroLevel = [];
  const maxed = [];
  filtered.forEach(obj => {
    // current level for this object
    const lvl = levels[obj.id] ?? 0;
    const maxIndex = obj.levels.length;
    if (lvl === 0) {
      // newly unlocked or unbuilt objects go below mid‑progress cards
      zeroLevel.push(obj);
    } else if (lvl >= maxIndex) {
      // fully upgraded objects go to the bottom
      maxed.push(obj);
    } else {
      // objects in progress (between 1 and max-1) go at the top
      midProgress.push(obj);
    }
  });
  // Order: mid‑progress first, then zero‑level, then maxed
  const ordered = [...midProgress, ...zeroLevel, ...maxed];
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
    // base cost for next level and discount; apply discounts only to pure cost levels
    let baseCost = nextData.cost ?? 0;
    // Determine whether the next level requires keys or stars
    const hasKeysOrStars = (nextData.keys_cost ?? 0) > 0 || (nextData.stars_cost ?? 0) > 0;
    // If no monetary cost but keys are required, convert keys to monetary cost for display/ROI purposes
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
    // incremental profit and population for next level (growth)
    const income = (nextData.income_per_hour ?? 0) - (currData.income_per_hour ?? 0);
    const pop = (nextData.population ?? 0) - (currData.population ?? 0);
    const dollarROI = adjustedCost > 0 ? ((income * 100) / adjustedCost).toFixed(5) : '∞';
    const popROI = adjustedCost > 0 ? ((pop * 100) / adjustedCost).toFixed(5) : '∞';
    // cost display with discount coloring only when discount is applied
    let costDisplay;
    if (discountApplied) {
      costDisplay = `<span style="text-decoration: line-through; color:#999;">${baseCost.toLocaleString()}</span> → <span style="color:#d17c00; font-weight:bold;">${adjustedCost.toLocaleString()}</span>`;
    } else {
      // If there is no cost but keys/stars are required, baseCost may be 0; display '-' when there is nothing to show
      costDisplay = adjustedCost ? adjustedCost.toLocaleString() : (baseCost ? baseCost.toLocaleString() : '-') ;
    }
    // marks for keys and stars based on next level requirements
    let marks = '';
    if ((nextData.keys_cost ?? 0) > 0) {
      marks += '<span title="Requires Keys">🔑</span>';
    }
    if ((nextData.stars_cost ?? 0) > 0) {
      marks += '<span title="Requires Stars">⭐</span>';
    }
    // Apply special styling if at max level
    if (lvl >= maxIndex) {
      card.classList.add('max-level');
    }
    if (lvl == 0) {
      card.classList.add('zero-level');
    }
    // Header row: name, ID, level controls
    const header = document.createElement('div');
    header.className = 'card-row card-header';
    const info = document.createElement('div');
    info.className = 'card-info';
    // Use obj.title if it exists, otherwise fall back to obj.name, then obj.id
    info.innerHTML = `<h3>${obj.title || obj.name || obj.id}</h3><small>Level: ${lvl} | Max: ${maxIndex} | ${obj.id}</small>`;

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
    statsRow.innerHTML = `<span>Cost: ${costDisplay}${marks}</span><span>Income: ${income.toLocaleString()}</span><span>Population: ${pop.toLocaleString()}</span>`;
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
  // Save both levels and discounts to object_levels.json
  saveLevelsAndDiscounts();
  renderCards();
  renderStats();
}

// Save current levels and discounts to object_levels.json
function saveLevelsAndDiscounts() {
    const dataToSave = {
        levels: levels,
        discounts: discountByType,
        // include adjustment settings so they persist when exporting/importing
        profitPercent: profitPercent,
        profitFixed: profitFixed,
        popPercent: popPercent,
        popFixed: popFixed,
        showInactive: showInactive
    };
    // Note: This part of the code is intended to be used in an environment where
    // we can write to a file. In a standard browser environment, this would
    // typically trigger a download.
    // For the purpose of this IDE simulation, we'll assume a file write is possible
    // or the download functionality is handled elsewhere.
    console.log('Saving data:', dataToSave);
    // Persist the current state into localStorage so that the interface can
    // restore user preferences (levels, discounts, adjustments and
    // visibility of inactive objects) across page reloads.  Note that the
    // application still relies on object_levels.json for a more permanent
    // export/import mechanism.
    try {
      localStorage.setItem('object_levels', JSON.stringify(dataToSave));
      localStorage.setItem('discounts', JSON.stringify(discountByType));
    } catch (err) {
      console.warn('Unable to save to localStorage:', err);
    }
    // In a real application, you would use a backend API or similar to save this.
    // For this example, we'll just keep the download functionality.
}

// Download current levels and discounts as JSON when user clicks the save button
document.getElementById('download-btn').onclick = () => {
  /*
   * Construct the object that will be written to object_levels.json.  In
   * addition to the levels and discount mappings, persist any adjustment
   * settings (profit/population multipliers and fixed adjustments) and the
   * showInactive flag so that user preferences are retained when the file is
   * re‑loaded.  Without including showInactive, toggling the checkbox
   * wouldn't be preserved across sessions.
   */
  const dataToDownload = {
    levels: levels,
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

// Load levels and discounts from a user-selected JSON file
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
      const loadedData = JSON.parse(e.target.result);
        // Basic validation to ensure it's a plausible file structure
      if (typeof loadedData === 'object' && loadedData !== null && loadedData.levels && loadedData.discounts) {
        /*
         * Replace existing data structures with those from the loaded file.
         * Validate and sanitize values as needed.  Also apply persisted
         * adjustment parameters and the showInactive flag.  If the latter
         * is omitted from the file (for backward‑compatibility with
         * pre‑existing files), keep the current checkbox state.  After
         * loading, re‑clamp level values to ensure they are within valid
         * bounds and refresh the UI.
         */
        levels = loadedData.levels;
        discountByType = loadedData.discounts;
        // Load adjustment values if provided
        profitPercent = loadedData.profitPercent != null ? loadedData.profitPercent : profitPercent;
        profitFixed = loadedData.profitFixed != null ? loadedData.profitFixed : profitFixed;
        popPercent = loadedData.popPercent != null ? loadedData.popPercent : popPercent;
        popFixed = loadedData.popFixed != null ? loadedData.popFixed : popFixed;
        // Apply showInactive flag if present; otherwise retain current setting
        if (loadedData.showInactive != null) {
          showInactive = loadedData.showInactive;
        }
        // Re-clamp level values after loading
        objects.forEach(o => {
          if (levels[o.id] == null) levels[o.id] = 0;
          const maxIndex = o.levels.length;
          if (levels[o.id] > maxIndex) levels[o.id] = maxIndex;
          if (levels[o.id] < 0) levels[o.id] = 0;
        });
         // Ensure discount keys exist for each type after loading
         objects.forEach(o => { if (discountByType[o.type] == null) discountByType[o.type] = 0; });
        // Update localStorage (optional, but good for persistence between sessions)
        localStorage.setItem('object_levels', JSON.stringify({
          levels: levels,
          discounts: discountByType,
          profitPercent: profitPercent,
          profitFixed: profitFixed,
          popPercent: popPercent,
          popFixed: popFixed,
          showInactive: showInactive
        }));
        localStorage.setItem('discounts', JSON.stringify(discountByType)); // Keep localStorage 'discounts' for backward compatibility or other uses
        // Update the checkbox UI to reflect the loaded state
        document.getElementById('show-inactive-checkbox').checked = showInactive;
        renderDiscountFields();
        renderAdjustmentFields();
        renderCards();
        renderStats();
        alert('Levels, discounts, adjustments and settings loaded successfully!');
      } else {
        alert('Invalid file format. Please select a file with levels and discounts.');
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
      // persist discounts and levels to object_levels.json
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

  // Helper to create a labeled numeric input
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
      // If a max is defined and value exceeds it, clamp
      if (options.max != null && val > options.max) val = options.max;
      if (options.min != null && val < options.min) val = options.min;
      valueSetter(val);
      // persist changes
      saveLevelsAndDiscounts();
      renderStats();
    };
    wrapper.appendChild(label);
    wrapper.appendChild(input);
    container.appendChild(wrapper);
  }

  // Profit percent (percentage multiplier, default 100%)
  addField('Profit percent (%)', () => profitPercent, (val) => { profitPercent = val; }, { min: 0 });
  // Profit fixed amount
  addField('Profit fixed', () => profitFixed, (val) => { profitFixed = val; });
  // Population percent (percentage multiplier, default 100%)
  addField('Population percent (%)', () => popPercent, (val) => { popPercent = val; }, { min: 0 });
  // Population fixed amount
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
  // Determine which objects are currently visible based on the selected type
  // and the showInactive flag.  Only these objects contribute to the
  // displayed card count and aggregated stats.
  const filteredByType = currentType === 'ALL'
    ? objects
    : objects.filter(o => o.type === currentType);
  const relevantObjects = showInactive
    ? filteredByType
    : filteredByType.filter(o => o.is_active);
  let totalProfit = 0;
  let totalPop = 0;
  /*
   * Cross metrics should accumulate values across levels 1 through the
   * current level. Level index 0 represents the base state and
   * therefore contributes no cross profit or population. When all
   * cards are at level 0, the totals should be zero.  Only the currently
   * visible cards are included in these totals so that the displayed
   * counts and aggregates reflect what the user sees on the page.
   */
  relevantObjects.forEach(obj => {
    const lvl = levels[obj.id] ?? 0;
    const curr = lvl > 0 ? (obj.levels[lvl - 1] || {}) : {};
    totalProfit += (curr.income_per_hour ?? 0);
    totalPop += (curr.population ?? 0);
  });
  const bar = document.getElementById('stats-bar');
  const totalCards = relevantObjects.length;
  // Compute adjusted totals based on percentage multipliers and fixed amounts
  const profitPercentValue = (totalProfit * (profitPercent / 100));
  const totalProfitAdjusted = profitFixed + profitPercentValue;
  const popPercentValue = (totalPop * (popPercent / 100));
  const totalPopAdjusted = popFixed + popPercentValue;
  // Compose display string; show original totals with their adjusted counterparts
  bar.textContent =
    `Total Cards: ${totalCards} | ` +
    `Total Profit: ${totalProfitAdjusted.toLocaleString()} | ` +
    `Total Population: ${totalPopAdjusted.toLocaleString()}`;
}

// Add event listener for the show/hide inactive checkbox
document.getElementById('show-inactive-checkbox').onchange = (e) => {
  showInactive = e.target.checked;
  saveLevelsAndDiscounts();
  renderCards();
};

// Initial render of cards with the default showInactive setting
renderCards();
