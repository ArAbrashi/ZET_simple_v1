let DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const DAY_HR_ED = {
  'Monday': 'Pon', 'Tuesday': 'Uto', 'Wednesday': 'Sri',
  'Thursday': 'Cet', 'Friday': 'Pet', 'Saturday': 'Sub', 'Sunday': 'Ned'
};
function edDayShort(name) {
  const base = name.replace(/ T\d+$/, '');
  const week = name.match(/ (T\d+)$/);
  const hr = DAY_HR_ED[base] || base.substring(0, 3);
  return week ? `${hr} ${week[1]}` : hr;
}
const HOURS_LABELS = Array.from({length:24}, (_,i) => String(i).padStart(2,'0')+':00');
const PARAMS_DEF = [
  { key: 'P_bat',             label: 'P bat',             hint: 'Max snaga baterije [MW]',       step: 0.1 },
  { key: 'E_bat',             label: 'E bat',             hint: 'Kapacitet baterije [MWh]',      step: 0.5 },
  { key: 'SOC_init',          label: 'SOC init',          hint: 'Pocetni SOC [%]',               step: 1 },
  { key: 'P_grid_max',        label: 'P grid max',        hint: 'Max snaga mreze [MW]',          step: 0.5 },
  { key: 'P_solar_installed', label: 'P solar inst.',     hint: 'Instalirana snaga solara [MW]', step: 0.5 },
  { key: 'n_bat_min',         label: 'n bat min',         hint: 'Min sati u istom rezimu [h]',   step: 1 },
  { key: 'price_export',      label: 'Cijena export',     hint: 'Cijena prodaje u mrezu [EUR/MWh]', step: 1 },
  { key: 'eta_charge',        label: 'Eta punjenje',      hint: 'Efikasnost punjenja [0-1]',     step: 0.01 },
  { key: 'eta_discharge',     label: 'Eta praznjenje',    hint: 'Efikasnost praznjenja [0-1]',   step: 0.01 },
  { key: 'soc_min',           label: 'SOC min',           hint: 'Minimalni SOC [%]',             step: 1 },
  { key: 'soc_max',           label: 'SOC max',           hint: 'Maksimalni SOC [%]',            step: 1 },
  { key: 'PENALTY_DEFICIT',   label: 'Penal manjak',      hint: 'Kazneni trosak [EUR/MWh]',      step: 1000 },
];

const CHART_CONFIGS = [
  { id: 'chart-price',  arr: 'prices',      color: '#8b5cf6', bg: 'rgba(139,92,246,0.08)', label: 'Cijena',    unit: 'EUR/MWh', round: 1 },
  { id: 'chart-cons',   arr: 'consumption', color: '#0ea5e9', bg: 'rgba(14,165,233,0.08)',  label: 'Potrosnja', unit: 'MW',      round: 2 },
  { id: 'chart-solar',  arr: 'solar',       color: '#f59e0b', bg: 'rgba(245,158,11,0.08)',  label: 'Solar',     unit: '',        round: 2 },
  { id: 'chart-afrrp',  arr: 'aFRRplus',    color: '#10b981', bg: 'rgba(16,185,129,0.08)',  label: 'aFRR+',     unit: 'MW',      round: 2 },
  { id: 'chart-afrrm',  arr: 'aFRRminus',   color: '#f43f5e', bg: 'rgba(244,63,94,0.08)',   label: 'aFRR-',     unit: 'MW',      round: 2 },
];

let state = {
  parameters: {},
  prices: new Array(168).fill(0),
  consumption: new Array(168).fill(0),
  solar: new Array(168).fill(0),
  aFRRplus: new Array(168).fill(0),
  aFRRminus: new Array(168).fill(0),
};
let originalState = {
  prices: new Array(168).fill(0),
  consumption: new Array(168).fill(0),
  solar: new Array(168).fill(0),
  aFRRplus: new Array(168).fill(0),
  aFRRminus: new Array(168).fill(0),
};
let currentDay = 0;
let currentView = 'chart';
let charts = {};
let dragModes = {};
CHART_CONFIGS.forEach(c => dragModes[c.id] = 'single');

// Chart.js global theme
Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = 'rgba(232,228,222,0.6)';
Chart.defaults.font.family = 'Outfit';

const SVG_SINGLE = `<svg viewBox="0 0 16 16"><circle cx="8" cy="5" r="2.5"/><line x1="8" y1="8" x2="8" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="5" y1="11" x2="8" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="11" y1="11" x2="8" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
const SVG_ALL = `<svg viewBox="0 0 16 16"><circle cx="4" cy="5" r="1.8"/><circle cx="8" cy="3" r="1.8"/><circle cx="12" cy="5" r="1.8"/><path d="M2 14 L4 8 L8 6 L12 8 L14 14" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><line x1="8" y1="6" x2="8" y2="12" stroke="currentColor" stroke-width="1" stroke-dasharray="1.5 1.5"/></svg>`;

const tooltipStyle = {
  backgroundColor: 'rgba(10,22,40,0.92)',
  titleColor: '#e2e8f0',
  bodyColor: '#94a3b8',
  borderColor: 'rgba(59,130,246,0.2)',
  borderWidth: 1,
  titleFont: { family: 'Outfit', weight: '600' },
  bodyFont: { family: 'Outfit' },
  padding: 14,
  cornerRadius: 10,
  boxPadding: 4,
};


function renderDragToggles() {
  CHART_CONFIGS.forEach(cfg => {
    const el = document.getElementById('drag-toggle-' + cfg.id);
    if (!el) return;
    el.innerHTML = `
      <button class="drag-mode-btn ${dragModes[cfg.id]==='single'?'active':''}"
        onclick="setDragMode('${cfg.id}','single')" title="Pomakni jednu tocku">
        ${SVG_SINGLE}<span>Jedna</span>
      </button>
      <button class="drag-mode-btn ${dragModes[cfg.id]==='all'?'active':''}"
        onclick="setDragMode('${cfg.id}','all')" title="Pomakni sve tocke zajedno">
        ${SVG_ALL}<span>Sve</span>
      </button>
      <div class="drag-toggle-sep"></div>
      <button class="drag-reset-btn" onclick="resetChart('${cfg.id}')" title="Vrati na pocetne vrijednosti">
        &#8635; Reset all
      </button>`;
  });
}

function setDragMode(chartId, mode) {
  dragModes[chartId] = mode;
  renderDragToggles();
}

function resetChart(cfgId) {
  const cfg = CHART_CONFIGS.find(c => c.id === cfgId);
  if (!cfg) return;
  const offset = currentDay * 24;
  for (let h = 0; h < 24; h++) {
    state[cfg.arr][offset + h] = originalState[cfg.arr][offset + h];
  }
  const origData = getOriginalDaySlice(cfg.arr, currentDay);
  const chart = charts[cfgId];
  chart.data.datasets[1].data = [...origData];
  chart.options.scales.y.max = Math.ceil(Math.max(...origData) * 1.5 * 10) / 10 || 1;
  chart.update('none');
  renderHourlyTable(currentDay);
  updateBadge(cfgId, origData);
  showToast(`${cfg.label} resetiran na pocetne vrijednosti`);
}

fetch('Input.json')
  .then(r => r.json())
  .then(data => {
    if (data.days) DAYS = data.days;
    state.parameters = { ...data.parameters };
    state.prices = [...data.prices];
    state.consumption = [...data.consumption];
    state.solar = [...data.solar];
    state.aFRRplus = [...data.aFRRplus];
    state.aFRRminus = [...data.aFRRminus];
    originalState.prices = [...data.prices];
    originalState.consumption = [...data.consumption];
    originalState.solar = [...data.solar];
    originalState.aFRRplus = [...data.aFRRplus];
    originalState.aFRRminus = [...data.aFRRminus];
    init();
  })
  .catch(() => { init(); });

function init() {
  const sub = document.getElementById('hourly-sub');
  if (sub) sub.innerHTML = `${DAYS.length} dana x 24 sata &mdash; cijene, potrosnja, solar, aFRR`;
  renderParams();
  renderDayTabs();
  renderCopySelects();
  renderDragToggles();
  renderHourlyTable(currentDay);
  buildAllCharts(currentDay);
}

function renderParams() {
  const container = document.getElementById('param-grid');
  const BAT_KEYS = ['P_bat','E_bat','SOC_init','n_bat_min','eta_charge','eta_discharge','soc_min','soc_max'];
  const batParams   = PARAMS_DEF.filter(p =>  BAT_KEYS.includes(p.key));
  const otherParams = PARAMS_DEF.filter(p => !BAT_KEYS.includes(p.key));

  function paramHTML(p) {
    return `<div class="param-item">
      <div class="param-label">${p.label}</div>
      <input class="param-input" type="number" step="${p.step}"
        value="${state.parameters[p.key] ?? 0}"
        onchange="state.parameters['${p.key}'] = parseFloat(this.value) || 0">
      <div class="param-hint">${p.hint}</div>
    </div>`;
  }

  function groupHTML(icon, iconStyle, title, params) {
    return `<div class="param-group">
      <div class="param-group-title">
        <span class="group-icon" style="${iconStyle}">${icon}</span>
        ${title}
      </div>
      <div class="param-grid">${params.map(paramHTML).join('')}</div>
    </div>`;
  }

  container.innerHTML =
    groupHTML('&#128267;', 'background:rgba(59,130,246,0.1);color:var(--blue-accent)', 'Baterija', batParams) +
    groupHTML('&#9881;',   'background:rgba(16,185,129,0.1);color:var(--emerald)',     'Mreža i ostalo', otherParams);
}

function renderDayTabs() {
  const el = document.getElementById('day-tabs');
  el.innerHTML = DAYS.map((name, i) =>
    `<button class="tab-btn ${i===0?'active':''}" onclick="selectDay(${i})">${edDayShort(name)}</button>`
  ).join('');
}

function renderCopySelects() {
  ['copy-from','copy-to'].forEach(id => {
    document.getElementById(id).innerHTML = DAYS.map((n,i) =>
      `<option value="${i}">${n}</option>`).join('');
  });
}

function setView(v) {
  saveCurrentTable();
  currentView = v;
  document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.view-tab')[v==='table'?0:1].classList.add('active');
  const tv = document.getElementById('table-view');
  const cv = document.getElementById('chart-view');
  tv.style.display = v === 'table' ? 'block' : 'none';
  cv.style.display = v === 'chart' ? 'block' : 'none';
  if (v === 'chart') {
    updateAllCharts(currentDay);
  }
}

function selectDay(d) {
  saveCurrentTable();
  currentDay = d;
  document.querySelectorAll('.tab-btn').forEach((t,i) => t.classList.toggle('active', i===d));
  renderHourlyTable(d);
  if (currentView === 'chart') updateAllCharts(d);
}

function renderHourlyTable(day) {
  const offset = day * 24;
  const tbody = document.getElementById('hourly-body');
  let html = '';
  for (let h = 0; h < 24; h++) {
    const i = offset + h;
    html += `<tr>
      <td class="hour-label">${String(h).padStart(2,'0')}:00</td>
      <td class="col-price"><input type="number" step="0.1" data-arr="prices" data-idx="${i}" value="${state.prices[i]}"></td>
      <td class="col-cons"><input type="number" step="0.1" data-arr="consumption" data-idx="${i}" value="${state.consumption[i]}"></td>
      <td class="col-solar"><input type="number" step="0.01" min="0" max="1" data-arr="solar" data-idx="${i}" value="${state.solar[i]}"></td>
      <td class="col-afrr-p"><input type="number" step="0.1" data-arr="aFRRplus" data-idx="${i}" value="${state.aFRRplus[i]}"></td>
      <td class="col-afrr-m"><input type="number" step="0.1" data-arr="aFRRminus" data-idx="${i}" value="${state.aFRRminus[i]}"></td>
    </tr>`;
  }
  tbody.innerHTML = html;
}

function saveCurrentTable() {
  document.querySelectorAll('#hourly-body input').forEach(inp => {
    const arr = inp.dataset.arr;
    const idx = parseInt(inp.dataset.idx);
    if (arr && !isNaN(idx)) state[arr][idx] = parseFloat(inp.value) || 0;
  });
}

const ENERGY_BADGES = {
  'chart-cons':  { badgeId: 'badge-cons',  unit: 'MWh', mult: 1 },
  'chart-solar': { badgeId: 'badge-solar', unit: 'MWh', mult: state.parameters.P_solar_installed || 2.5 },
};

function getDaySlice(arr, day) {
  return state[arr].slice(day * 24, day * 24 + 24);
}

function getOriginalDaySlice(arr, day) {
  return originalState[arr].slice(day * 24, day * 24 + 24);
}

function updateBadge(cfgId, data) {
  const badge = ENERGY_BADGES[cfgId];
  if (!badge) return;
  let mult = badge.mult;
  if (cfgId === 'chart-solar') mult = state.parameters.P_solar_installed || 2.5;
  const sum = data.reduce((s, v) => s + v, 0) * mult;

  const arrKey = CHART_CONFIGS.find(c => c.id === cfgId).arr;
  const origData = getOriginalDaySlice(arrKey, currentDay);
  const origSum = origData.reduce((s, v) => s + v, 0) * mult;

  const el = document.getElementById(badge.badgeId);
  if (el) {
    el.textContent = sum.toFixed(1) + ' ' + badge.unit;
    el.classList.remove('changed');
    void el.offsetWidth;
    el.classList.add('changed');
  }

  const origEl = document.getElementById(badge.badgeId + '-orig');
  const hasChanged = Math.abs(sum - origSum) > 0.05;
  if (origEl) {
    origEl.textContent = origSum.toFixed(1) + ' ' + badge.unit;
    origEl.classList.toggle('visible', hasChanged);
  }

  const pctEl = document.getElementById(badge.badgeId + '-pct');
  if (pctEl) {
    if (hasChanged && origSum > 0) {
      const pct = ((sum - origSum) / origSum) * 100;
      const sign = pct > 0 ? '+' : '';
      pctEl.textContent = sign + pct.toFixed(1) + '%';
      pctEl.classList.remove('up', 'down');
      pctEl.classList.add(pct > 0 ? 'up' : 'down');
      pctEl.classList.add('visible');
    } else {
      pctEl.classList.remove('visible');
    }
  }
}

function buildAllCharts(day) {
  CHART_CONFIGS.forEach(cfg => {
    if (charts[cfg.id]) charts[cfg.id].destroy();
    const canvas = document.getElementById(cfg.id);
    const ctx = canvas.getContext('2d');
    const data = getDaySlice(cfg.arr, day);
    const origData = getOriginalDaySlice(cfg.arr, day);

    updateBadge(cfg.id, data);

    // Info bar — injektira se jednom iznad canvasa
    let infoBar = document.getElementById('info-' + cfg.id);
    if (!infoBar) {
      infoBar = document.createElement('div');
      infoBar.id = 'info-' + cfg.id;
      infoBar.className = 'chart-info-bar';
      canvas.parentNode.insertBefore(infoBar, canvas);
    }
    infoBar.innerHTML = '<span class="info-placeholder">Prijeđite mišem za detalje</span>';

    const datasets = [
      {
        label: 'Original',
        data: [...origData],
        borderColor: 'rgba(148,163,184,0.35)',
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        borderDash: [4, 4],
        pointRadius: 3,
        pointBackgroundColor: 'rgba(148,163,184,0.25)',
        pointBorderColor: 'rgba(148,163,184,0.4)',
        pointBorderWidth: 1,
        pointHitRadius: 0,
        pointHoverRadius: 3,
        fill: false,
        tension: 0.15,
        order: 2,
      },
      {
        label: cfg.label,
        data: [...data],
        borderColor: cfg.color,
        backgroundColor: cfg.bg,
        borderWidth: 2.5,
        pointRadius: 4,
        pointHoverRadius: 7,
        pointBackgroundColor: cfg.color,
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        pointHitRadius: 10,
        fill: true,
        tension: 0.15,
        order: 1,
      }
    ];

    charts[cfg.id] = new Chart(ctx, {
      type: 'line',
      data: { labels: HOURS_LABELS, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          dragData: {
            round: cfg.round,
            showTooltip: false,
            dragX: false,
            onDragStart: () => false,
            onDrag: () => false,
            onDragEnd: () => {},
          },
          tooltip: {
            enabled: false,
            external: ({ chart, tooltip }) => {
              const bar = document.getElementById('info-' + cfg.id);
              if (!bar || tooltip.opacity === 0 || !tooltip.dataPoints?.length) return;
              const dp = tooltip.dataPoints.find(p => p.datasetIndex === 1);
              if (!dp) return;
              const curr = +dp.raw;
              const orig = +(chart.data.datasets[0].data[dp.dataIndex] ?? curr);
              const diff = +(curr - orig).toFixed(cfg.round);
              const sign = diff > 0 ? '+' : '';
              const cls  = diff > 0 ? 'up' : diff < 0 ? 'dn' : '';
              const pct  = orig !== 0 ? (diff / orig) * 100 : 0;
              const u    = cfg.unit ? ` <span class="info-unit">${cfg.unit}</span>` : '';
              bar.innerHTML =
                `<span class="info-hour">${dp.label}</span>` +
                `<span class="info-sep">|</span>` +
                `<span class="info-val">${curr.toFixed(cfg.round)}${u}</span>` +
                (Math.abs(diff) > 0
                  ? `<span class="info-sep">orig</span>` +
                    `<span class="info-orig">${orig.toFixed(cfg.round)}${u}</span>` +
                    `<span class="info-sep">|</span>` +
                    `<span class="info-diff ${cls}">${sign}${Math.abs(diff).toFixed(cfg.round)}${u}</span>` +
                    `<span class="info-pct ${cls}">(${sign}${pct.toFixed(1)}%)</span>`
                  : '');
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(232,228,222,0.5)' },
            ticks: {
              color: '#94a3b8',
              font: { family: 'Outfit', size: 11 },
              maxRotation: 0, autoSkip: true, maxTicksLimit: 12,
            }
          },
          y: {
            beginAtZero: true,
            max: Math.ceil(Math.max(...data, ...origData) * 1.5 * 10) / 10 || 1,
            grid: { color: 'rgba(232,228,222,0.5)' },
            ticks: {
              color: '#94a3b8',
              font: { family: 'Outfit', size: 11 }
            }
          }
        }
      }
    });

    // ── Own drag implementation (Pointer Events API) ────────────────────────
    // setPointerCapture routes all pointer events to the canvas element so
    // e.offsetY is always canvas-relative, even when mouse leaves the canvas.
    // No document-level listeners needed — avoids all capture-phase conflicts.
    ;(function attachDrag() {
      if (canvas._removeDragListeners) canvas._removeDragListeners();

      let isDragging         = false;
      let dragIndex          = null;
      let dragStartCursorVal = null;  // cursor Y in data-space at pointerdown
      let dragStartVal       = null;
      let dragStartAllData   = null;

      function findPointIndex(offsetX, offsetY) {
        const chart = charts[cfg.id];
        const { top, bottom } = chart.chartArea;
        if (offsetY < top || offsetY > bottom) return -1;
        const meta = chart.getDatasetMeta(1);
        if (!meta?.data?.length) return -1;
        let best = -1, bestDx = Infinity;
        meta.data.forEach((pt, i) => {
          const dx = Math.abs(offsetX - pt.x);
          if (dx < bestDx) { bestDx = dx; best = i; }
        });
        return best;
      }

      // Expand Y axis when a point reaches the current max.
      // Re-anchors dragStartCursorVal so the delta stays consistent after
      // the scale change (prevents a jump in point position).
      function expandIfNeeded(chart, peakVal, offsetY) {
        if (peakVal < chart.options.scales.y.max) return;
        const scale        = chart.scales.y;
        const preCursorVal = scale.getValueForPixel(offsetY);
        chart.options.scales.y.max = Math.ceil(peakVal * 1.05 * 10) / 10;
        chart.update('none');
        dragStartCursorVal += scale.getValueForPixel(offsetY) - preCursorVal;
      }

      function applyDelta(offsetY) {
        const chart      = charts[cfg.id];
        const scale      = chart.scales.y;
        const p          = Math.pow(10, cfg.round);
        const mode       = dragModes[cfg.id];
        const cursorVal  = scale.getValueForPixel(offsetY);
        const delta      = cursorVal - dragStartCursorVal;

        if (mode === 'all' && dragStartAllData) {
          const newData = dragStartAllData.map(v =>
            Math.max(0, Math.round((v + delta) * p) / p)
          );
          // Expand based on the highest point among all 24, not just the dragged one
          expandIfNeeded(chart, Math.max(...newData), offsetY);
          chart.data.datasets[1].data = newData;
          chart.update('none');
          updateBadge(cfg.id, newData);
        } else {
          const corrected = Math.max(0, Math.round((dragStartVal + delta) * p) / p);
          expandIfNeeded(chart, corrected, offsetY);
          chart.data.datasets[1].data[dragIndex] = corrected;
          chart.update('none');
          updateBadge(cfg.id, chart.data.datasets[1].data);
        }
      }

      function commitDrag() {
        const chart       = charts[cfg.id];
        const offset      = currentDay * 24;
        const currentData = chart.data.datasets[1].data;
        const mode        = dragModes[cfg.id];

        if (mode === 'all') {
          for (let h = 0; h < 24; h++) {
            state[cfg.arr][offset + h] = currentData[h];
            const inp = document.querySelector(`input[data-arr="${cfg.arr}"][data-idx="${offset + h}"]`);
            if (inp) inp.value = currentData[h];
          }
          updateBadge(cfg.id, currentData);
        } else {
          const finalVal  = currentData[dragIndex];
          const globalIdx = offset + dragIndex;
          state[cfg.arr][globalIdx] = finalVal;
          const inp = document.querySelector(`input[data-arr="${cfg.arr}"][data-idx="${globalIdx}"]`);
          if (inp) inp.value = finalVal;
          updateBadge(cfg.id, currentData);
        }
      }

      function onPointerDown(e) {
        if (e.button !== 0) return;
        const idx = findPointIndex(e.offsetX, e.offsetY);
        if (idx === -1) return;
        canvas.setPointerCapture(e.pointerId);
        isDragging         = true;
        dragIndex          = idx;
        dragStartAllData   = [...charts[cfg.id].data.datasets[1].data];
        dragStartVal       = dragStartAllData[idx];
        dragStartCursorVal = charts[cfg.id].scales.y.getValueForPixel(e.offsetY);
        e.preventDefault();
      }

      function onPointerMove(e) {
        if (!isDragging) return;
        applyDelta(e.offsetY);
      }

      function onPointerUp(e) {
        if (!isDragging) return;
        isDragging = false;
        canvas.releasePointerCapture(e.pointerId);
        commitDrag();
        dragIndex = dragStartCursorVal = dragStartVal = dragStartAllData = null;
      }

      canvas.addEventListener('pointerdown', onPointerDown, { capture: true });
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup',   onPointerUp);
      canvas.addEventListener('pointercancel', onPointerUp);

      canvas._removeDragListeners = () => {
        canvas.removeEventListener('pointerdown',   onPointerDown, { capture: true });
        canvas.removeEventListener('pointermove',   onPointerMove);
        canvas.removeEventListener('pointerup',     onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerUp);
        delete canvas._removeDragListeners;
      };
    })();
    // ────────────────────────────────────────────────────────────────────────
  });
}

function updateAllCharts(day) {
  CHART_CONFIGS.forEach(cfg => {
    const chart = charts[cfg.id];
    if (!chart) return;
    const data = getDaySlice(cfg.arr, day);
    const origData = getOriginalDaySlice(cfg.arr, day);
    chart.data.datasets[0].data = [...origData];
    chart.data.datasets[1].data = [...data];
    chart.update('none');
    updateBadge(cfg.id, data);
  });
}

function buildJSON() {
  saveCurrentTable();
  return {
    description: `Hourly electricity prices and factory consumption, ${DAYS.length} days x 24 hours`,
    days: DAYS,
    price_unit: "EUR/MWh",
    consumption_unit: "MW",
    parameters: {
      P_bat: state.parameters.P_bat,
      E_bat: state.parameters.E_bat,
      SOC_init: state.parameters.SOC_init,
      P_grid_max: state.parameters.P_grid_max,
      PENALTY_DEFICIT: state.parameters.PENALTY_DEFICIT,
      verbose: true,
      P_solar_installed: state.parameters.P_solar_installed,
      n_bat_min: state.parameters.n_bat_min,
      price_export: state.parameters.price_export,
      eta_charge: state.parameters.eta_charge,
      eta_discharge: state.parameters.eta_discharge,
      soc_min: state.parameters.soc_min,
      soc_max: state.parameters.soc_max,
    },
    prices: state.prices,
    consumption: state.consumption,
    aFRR_unit: "MW",
    aFRRplus: state.aFRRplus,
    aFRRminus: state.aFRRminus,
    solar_unit: "kW (normalizirano na 1 kW instalirane snage)",
    solar: state.solar,
  };
}

function downloadJSON() {
  const json = JSON.stringify(buildJSON(), null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'Input.json';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Input.json preuzet');
}

function saveToServer() {
  const json = JSON.stringify(buildJSON(), null, 2);
  fetch('/save-input', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: json
  }).then(r => {
    if (r.ok) showToast('Spremljeno u Input.json');
    else throw new Error();
  }).catch(() => {
    downloadJSON();
    showToast('Server nedostupan — preuzeto kao datoteka');
  });
}

function loadFile() { document.getElementById('file-input').click(); }

function handleFileLoad(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (data.parameters) state.parameters = { ...data.parameters };
      if (data.prices) { state.prices = [...data.prices]; originalState.prices = [...data.prices]; }
      if (data.consumption) { state.consumption = [...data.consumption]; originalState.consumption = [...data.consumption]; }
      if (data.solar) { state.solar = [...data.solar]; originalState.solar = [...data.solar]; }
      if (data.aFRRplus) { state.aFRRplus = [...data.aFRRplus]; originalState.aFRRplus = [...data.aFRRplus]; }
      if (data.aFRRminus) { state.aFRRminus = [...data.aFRRminus]; originalState.aFRRminus = [...data.aFRRminus]; }
      renderParams();
      renderHourlyTable(currentDay);
      buildAllCharts(currentDay);
      showToast('JSON ucitan: ' + file.name);
    } catch { showToast('Greska pri citanju JSON-a'); }
  };
  reader.readAsText(file);
  e.target.value = '';
}

function copyDay() {
  saveCurrentTable();
  const from = parseInt(document.getElementById('copy-from').value);
  const to = parseInt(document.getElementById('copy-to').value);
  if (from === to) return;
  const oFrom = from * 24, oTo = to * 24;
  ['prices','consumption','solar','aFRRplus','aFRRminus'].forEach(arr => {
    for (let h = 0; h < 24; h++) state[arr][oTo + h] = state[arr][oFrom + h];
  });
  if (currentDay === to) {
    renderHourlyTable(to);
    if (currentView === 'chart') updateAllCharts(to);
  }
  showToast(`${DAYS[from]} kopiran u ${DAYS[to]}`);
}

function fillZeros() {
  saveCurrentTable();
  const offset = currentDay * 24;
  ['prices','consumption','solar','aFRRplus','aFRRminus'].forEach(arr => {
    for (let h = 0; h < 24; h++) state[arr][offset + h] = 0;
  });
  renderHourlyTable(currentDay);
  if (currentView === 'chart') updateAllCharts(currentDay);
  showToast(`${DAYS[currentDay]} popunjen nulama`);
}

function runSimulation() {
  const btn = document.getElementById('run-btn');
  btn.disabled = true;
  btn.innerHTML = '&#9203; Racunam...';
  showToast('Simulacija pokrenuta...');
  fetch('/run-simulation', { method: 'POST' })
    .then(r => r.json())
    .then(data => {
      btn.disabled = false;
      btn.innerHTML = '&#9654; Pokreni simulaciju';
      if (data.ok) {
        showToast('Simulacija zavrsena! Otvorite Dashboard.');
      } else {
        showToast('Greska u simulaciji. Provjerite konzolu.');
        console.error('STDERR:', data.stderr);
        console.log('STDOUT:', data.stdout);
      }
    })
    .catch(() => {
      btn.disabled = false;
      btn.innerHTML = '&#9654; Pokreni simulaciju';
      showToast('Server nedostupan. Pokrenite server.py');
    });
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}
