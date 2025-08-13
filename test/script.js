// Helper: fetch JSON
async function loadJSON(path) {
  const resp = await fetch(path);
  if (!resp.ok) throw new Error('Failed to load ' + path);
  return resp.json();
}

/* ========== Global state ========== */
let objects = [];          // [{id, name, type, is_active, title, levels:[{level,cost,income_per_hour,population,keys_cost,stars_cost,conditions,available_from}], _lvlIndex:Map}]
let levels = {};           // { id: currentLevelInt }
let currentType = 'ALL';
let sortOption = 'none';

// Discounts & total-adjustment settings
let discountByType = {};   // { type: percent(0..100) }
let profitPercent = 100;
let profitFixed = 0;
let popPercent = 100;
let popFixed = 0;

// Key valuation
const KEY_VALUE = 1_250_000;

// Whether to show inactive objects
let showInactive = false;

/* ========== Decoded->Final transformer & loaders ========== */
async function loadDecodedOrFinal() {
  // Try decoded first: expected shape is a list of groups (each group = list of level records for a single object)
  try {
    const decoded = await loadJSON('gameobjects_decoded.json');
    if (Array.isArray(decoded) && Array.isArray(decoded[0])) {
      const out = [];
      for (const group of decoded) {
        if (!group || !group.length) continue;
        const first = group[0];
        const obj = {
          id: first.id,
          name: first.name_en || first.name_ru || first.name || first.id,
          type: first.type || 'UNKNOWN',
          is_active: first.is_active ?? true,
          title: first.name_en || first.name_ru || first.name || first.id,
          levels: group
            .slice()
            .sort((a, b) => (a.level ?? 0) - (b.level ?? 0))
            .map(item => ({
              level: item.level ?? 0,
              cost: Number(item.cost ?? 0),
              income_per_hour: Number(item.income_per_hour ?? 0),
              population: Number(item.population ?? 0),
              keys_cost: Number(item.keys_cost ?? 0),
              stars_cost: Number(item.stars_cost ?? 0),
              conditions: item.conditions || null,
              available_from: item.available_from || null
            }))
        };
        out.push(obj);
      }
      return out;
    }
  } catch (e) {
    console.warn('No decoded data or failed to parse:', e);
  }

  // Fallback to final (already shaped)
  const finalData = await loadJSON('gameobjects_final.json');
  return Array.isArray(finalData) ? finalData : [];
}

/* ========== Utilities ========== */

// Build quick lookup from "level number" -> index in levels[]
function buildLevelIndex(obj) {
  const map = new Map();
  (obj.levels || []).forEach((lv, idx) => {
    map.set(Number(lv.level || 0), idx);
  });
  obj._lvlIndex = map;
}

// Effective upgrade cost = money + keys * KEY_VALUE, minus type discount
function effectiveCost(nextLevel, typeDiscountPct = 0) {
  const money = Number(nextLevel?.cost ?? 0);
  const keys = Number(nextLevel?.keys_cost ?? 0);
  const base = money + keys * KEY_VALUE;
  const disc = Math.max(0, Math.min(100, Number(typeDiscountPct || 0)));
  return Math.max(0, Math.round(base * (1 - disc / 100)));
}

// Check conditions. Supports several shapes:
//
// 1) { requires: [ { id:'obj_x', level:3 }, ... ] }
// 2) { requires: { 'obj_x':3, 'obj_y':1 } }
// 3) { 'obj_x':3, 'obj_y':1 } (direct map)
// 4) [ { id:'obj_x', level:3 }, ... ] (bare array)
// If you want to gate by available_from (time), add checks here.
function prerequisitesMet(nextLevel, currentLevels) {
  const conds = nextLevel?.conditions;
  if (!conds) return true;

  let requires = conds.requires ?? conds;
  if (!requires) return true;

  if (Array.isArray(requires)) {
    for (const r of requires) {
      if (!r || !r.id) continue;
      const need = Number(r.level ?? 1);
      if ((currentLevels[r.id] ?? 0) < need) return false;
    }
    return true;
  }

  if (typeof requires === 'object') {
    for (const [objId, minLvl] of Object.entries(requires)) {
      const need = Number(minLvl ?? 1);
      if ((currentLevels[objId] ?? 0) < need) return false;
    }
    return true;
  }

  return true;
}

// Compute deltas from current -> next
function getNextUpgradeDeltas(obj, currentLevel) {
  const lvls = obj?.levels || [];
  // Your stored "level" in object_levels.json is the CURRENT achieved level number.
  // We find current stats by level == currentLevel, and next by level == currentLevel + 1.
  const curIdx = obj._lvlIndex.get(Number(currentLevel)) ?? -1;
  const nxtIdx = obj._lvlIndex.get(Number(currentLevel) + 1);

  const cur = curIdx >= 0 ? lvls[curIdx] : { income_per_hour: 0, population: 0 };
  const nextLevel = (nxtIdx != null) ? lvls[nxtIdx] : null;

  if (!nextLevel) {
    return { nextLevel: null, dPPH: 0, dPOP: 0 };
  }

  const dPPH = Math.max(0, Number(nextLevel.income_per_hour ?? 0) - Number(cur.income_per_hour ?? 0));
  const dPOP = Math.max(0, Number(nextLevel.population ?? 0) - Number(cur.population ?? 0));
  return { nextLevel, dPPH, dPOP };
}

/* ========== Sorting ========== */
function sortObjects(list) {
  const cloned = list.slice();

  cloned.sort((a, b) => {
    const aL = levels[a.id] ?? 0;
    const bL = levels[b.id] ?? 0;

    const aN = getNextUpgradeDeltas(a, aL);
    const bN = getNextUpgradeDeltas(b, bL);

    const aReady = aN.nextLevel && prerequisitesMet(aN.nextLevel, levels);
    const bReady = bN.nextLevel && prerequisitesMet(bN.nextLevel, levels);

    const aCost = aN.nextLevel ? effectiveCost(aN.nextLevel, discountByType[a.type]) : Infinity;
    const bCost = bN.nextLevel ? effectiveCost(bN.nextLevel, discountByType[b.type]) : Infinity;

    const aPPH = aN.dPPH, bPPH = bN.dPPH;
    const aPOP = aN.dPOP, bPOP = bN.dPOP;

    const aPPHROI = aReady && aCost > 0 ? aPPH / aCost : -Infinity;
    const bPPHROI = bReady && bCost > 0 ? bPPH / bCost : -Infinity;
    const aPOPROI = aReady && aCost > 0 ? aPOP / aCost : -Infinity;
    const bPOPROI = bReady && bCost > 0 ? bPOP / bCost : -Infinity;

    switch (sortOption) {
      case 'best-pph': { // conditions-aware ΔPPH per cost
        if (bPPHROI !== aPPHROI) return bPPHROI - aPPHROI;
        if (aCost !== bCost) return aCost - bCost;
        if (bPPH !== aPPH) return bPPH - aPPH;
        return String(a.id).localeCompare(String(b.id));
      }
      case 'best-pop': { // conditions-aware ΔPOP per cost
        if (bPOPROI !== aPOPROI) return bPOPROI - aPOPROI;
        if (aCost !== bCost) return aCost - bCost;
        if (bPOP !== aPOP) return bPOP - aPOP;
        return String(a.id).localeCompare(String(b.id));
      }

      // Existing convenient sorts (fallbacks):
      case 'price-high-low': return (bCost) - (aCost);
      case 'price-low-high': return (aCost) - (bCost);
      case 'profit-high-low': return (bPPH) - (aPPH);
      case 'profit-low-high': return (aPPH) - (bPPH);
      case 'dollar-roi-high-low': return (bPPHROI) - (aPPHROI);
      case 'dollar-roi-low-high': return (aPPHROI) - (bPPHROI);
      case 'population-roi-high-low': return (bPOPROI) - (aPOPROI);
      case 'population-roi-low-high': return (aPOPROI) - (bPOPROI);
      case 'level-low-high': return (levels[a.id] ?? 0) - (levels[b.id] ?? 0);
      case 'level-high-low': return (levels[b.id] ?? 0) - (levels[a.id] ?? 0);
      default: return 0;
    }
  });

  return cloned;
}

/* ========== Rendering ========== */

function renderBottomTabs() {
  const bar = document.getElementById('bottom-tabs');
  const types = Array.from(new Set(objects.map(o => o.type)));
  bar.innerHTML = '';

  const makeBtn = (label, typeValue) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    if (currentType === typeValue) btn.classList.add('active');
    btn.onclick = () => {
      currentType = typeValue;
      renderCards();
      renderBottomTabs();
    };
    return btn;
  };

  bar.appendChild(makeBtn('ALL', 'ALL'));
  types.forEach(t => bar.appendChild(makeBtn(t, t)));
}

function fmt(n) {
  return (Number(n) || 0).toLocaleString();
}

function renderCards() {
  const cardsDiv = document.getElementById('cards');
  if (!cardsDiv) return;

  let list = objects;
  if (!showInactive) {
    list = list.filter(o => o.is_active !== false);
  }
  if (currentType !== 'ALL') {
    list = list.filter(o => o.type === currentType);
  }

  list = sortObjects(list);

  cardsDiv.innerHTML = '';
  for (const o of list) {
    const curr = levels[o.id] ?? 0;
    const { nextLevel, dPPH, dPOP } = getNextUpgradeDeltas(o, curr);
    const ready = nextLevel ? prerequisitesMet(nextLevel, levels) : false;
    const cost = nextLevel ? effectiveCost(nextLevel, discountByType[o.type]) : 0;

    const pphROI = nextLevel && cost > 0 ? (dPPH / cost) : 0;
    const popROI = nextLevel && cost > 0 ? (dPOP / cost) : 0;

    const card = document.createElement('div');
    card.className = 'card';

    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = `${o.title || o.name} (${o.type})`;
    card.appendChild(title);

    const lvl = document.createElement('div');
    lvl.className = 'card-sub';
    lvl.textContent = `Level: ${curr}`;
    card.appendChild(lvl);

    const stats = document.createElement('div');
    stats.className = 'card-stats';
    stats.innerHTML = `
      <div>ΔPPH: <b>${fmt(dPPH)}</b></div>
      <div>ΔPOP: <b>${fmt(dPOP)}</b></div>
      <div>Cost: <b>${fmt(cost)}</b></div>
      <div>PPH ROI: <b>${pphROI.toFixed(6)}</b></div>
      <div>POP ROI: <b>${popROI.toFixed(6)}</b></div>
      ${nextLevel && !ready ? `<div style="color:#ffaf3f">Blocked by conditions</div>` : ``}
    `;
    card.appendChild(stats);

    const controls = document.createElement('div');
    controls.className = 'card-controls';
    const dec = document.createElement('button');
    dec.textContent = '-';
    dec.onclick = () => {
      levels[o.id] = Math.max(0, (levels[o.id] ?? 0) - 1);
      renderCards(); renderStats(); saveLocal();
    };
    const inc = document.createElement('button');
    inc.textContent = '+';
    inc.onclick = () => {
      // clamp to max defined level
      const maxLvl = Math.max(0, ...o.levels.map(lv => Number(lv.level || 0)));
      levels[o.id] = Math.min(maxLvl, (levels[o.id] ?? 0) + 1);
      renderCards(); renderStats(); saveLocal();
    };
    controls.appendChild(dec);
    controls.appendChild(inc);
    card.appendChild(controls);

    cardsDiv.appendChild(card);
  }
}

function renderStats() {
  const bar = document.getElementById('stats-bar');
  if (!bar) return;

  let totalPPH = 0;
  let totalPOP = 0;

  for (const o of objects) {
    const curr = levels[o.id] ?? 0;
    const idx = o._lvlIndex.get(curr);
    const cur = (idx != null && idx >= 0) ? o.levels[idx] : { income_per_hour: 0, population: 0 };
    totalPPH += Number(cur.income_per_hour || 0);
    totalPOP += Number(cur.population || 0);
  }

  // Apply adjustments
  totalPPH = totalPPH * (profitPercent / 100) + profitFixed;
  totalPOP = totalPOP * (popPercent / 100) + popFixed;

  bar.textContent = `Total PPH: ${fmt(totalPPH)} | Total POP: ${fmt(totalPOP)}`;
}

function renderDiscountFields() {
  const container = document.getElementById('discount-fields');
  if (!container) return;
  container.innerHTML = '';

  const types = Array.from(new Set(objects.map(o => o.type)));
  types.forEach(t => {
    const row = document.createElement('div');
    const label = document.createElement('label');
    label.textContent = `Discount for ${t} (%)`;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = 0; input.max = 100; input.step = 1;
    input.value = discountByType[t] ?? 0;
    input.onchange = () => {
      discountByType[t] = Number(input.value || 0);
      renderCards(); renderStats(); saveLocal();
    };
    row.appendChild(label);
    row.appendChild(input);
    container.appendChild(row);
  });

  // Show inactive toggle if present
  const showCb = document.getElementById('show-inactive-checkbox');
  if (showCb) {
    showCb.checked = !!showInactive;
    showCb.onchange = () => { showInactive = !!showCb.checked; renderCards(); saveLocal(); };
  }
}

function renderAdjustmentFields() {
  const container = document.getElementById('adjust-fields');
  if (!container) return;
  container.innerHTML = '';

  const mk = (labelText, value, onChange, attrs = {}) => {
    const row = document.createElement('div');
    const label = document.createElement('label');
    label.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'number';
    Object.assign(input, attrs);
    input.value = value;
    input.onchange = () => { onChange(Number(input.value || 0)); renderStats(); saveLocal(); };
    row.appendChild(label);
    row.appendChild(input);
    container.appendChild(row);
  };

  mk('Profit %', profitPercent, v => profitPercent = v, { min: 0, max: 1000, step: 1 });
  mk('Profit + (fixed)', profitFixed, v => profitFixed = v, { step: 1 });
  mk('Population %', popPercent, v => popPercent = v, { min: 0, max: 1000, step: 1 });
  mk('Population + (fixed)', popFixed, v => popFixed = v, { step: 1 });
}

/* ========== Save/Load ========== */
function saveLocal() {
  try {
    const payload = {
      levels,
      discounts: discountByType,
      profitPercent,
      profitFixed,
      popPercent,
      popFixed,
      showInactive
    };
    localStorage.setItem('ch_state', JSON.stringify(payload));
  } catch (e) {
    console.warn('localStorage save failed', e);
  }
}

function loadLocal() {
  try {
    const raw = localStorage.getItem('ch_state');
    if (!raw) return;
    const data = JSON.parse(raw);
    levels = data.levels || levels;
    discountByType = data.discounts || discountByType;
    profitPercent = data.profitPercent ?? profitPercent;
    profitFixed = data.profitFixed ?? profitFixed;
    popPercent = data.popPercent ?? popPercent;
    popFixed = data.popFixed ?? popFixed;
    showInactive = data.showInactive ?? showInactive;
  } catch (e) {
    console.warn('localStorage load failed', e);
  }
}

function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ========== Init ========== */
(async function init() {
  // Load objects
  objects = await loadDecodedOrFinal();

  // Load levels/settings (from object_levels.json if present)
  try {
    const loadedData = await loadJSON('object_levels.json');
    if (loadedData && typeof loadedData === 'object') {
      levels = loadedData.levels || {};
      discountByType = loadedData.discounts || {};
      profitPercent = loadedData.profitPercent ?? profitPercent;
      profitFixed   = loadedData.profitFixed   ?? profitFixed;
      popPercent    = loadedData.popPercent    ?? popPercent;
      popFixed      = loadedData.popFixed      ?? popFixed;
      showInactive  = loadedData.showInactive  ?? showInactive;
    }
  } catch (err) {
    console.warn('object_levels.json not found or invalid, using defaults.');
  }

  // Overlay with localStorage if present
  loadLocal();

  // Build level indexes and ensure defaults
  objects.forEach(o => {
    buildLevelIndex(o);
    if (levels[o.id] == null) levels[o.id] = 0;
    if (discountByType[o.type] == null) discountByType[o.type] = 0;

    // clamp level into [minLevel, maxLevel]
    const maxLvl = Math.max(0, ...o.levels.map(lv => Number(lv.level || 0)));
    if (levels[o.id] > maxLvl) levels[o.id] = maxLvl;
    if (levels[o.id] < 0) levels[o.id] = 0;
  });

  // Hook up UI controls
  const sortSel = document.getElementById('sort-select');
  if (sortSel) {
    sortSel.onchange = () => { sortOption = sortSel.value; renderCards(); };
  }
  const settingsBtn = document.getElementById('settings-btn');
  if (settingsBtn) {
    settingsBtn.onclick = () => {
      const p = document.getElementById('settings-panel');
      if (!p) return;
      p.style.display = p.style.display === 'none' ? 'block' : 'none';
    };
  }
  const dlBtn = document.getElementById('download-btn');
  if (dlBtn) {
    dlBtn.onclick = () => {
      const payload = {
        levels,
        discounts: discountByType,
        profitPercent,
        profitFixed,
        popPercent,
        popFixed,
        showInactive
      };
      downloadJSON('object_levels.json', payload);
    };
  }
  const loadBtn = document.getElementById('load-btn');
  const loadInput = document.getElementById('load-levels-input');
  if (loadBtn && loadInput) {
    loadBtn.onclick = () => loadInput.click();
    loadInput.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        const data = JSON.parse(text);
        levels = data.levels || levels;
        discountByType = data.discounts || discountByType;
        profitPercent = data.profitPercent ?? profitPercent;
        profitFixed   = data.profitFixed   ?? profitFixed;
        popPercent    = data.popPercent    ?? popPercent;
        popFixed      = data.popFixed      ?? popFixed;
        showInactive  = data.showInactive  ?? showInactive;

        // clamp after load
        objects.forEach(o => {
          const maxLvl = Math.max(0, ...o.levels.map(lv => Number(lv.level || 0)));
          if (levels[o.id] > maxLvl) levels[o.id] = maxLvl;
          if (levels[o.id] < 0) levels[o.id] = 0;
        });

        renderDiscountFields();
        renderAdjustmentFields();
        renderCards();
        renderStats();
        saveLocal();
      } catch (err) {
        alert('Invalid JSON file.');
      }
    };
  }

  // Initial render
  renderDiscountFields();
  renderAdjustmentFields();
  renderBottomTabs();
  renderCards();
  renderStats();
})();
