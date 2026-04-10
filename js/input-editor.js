const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
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
  { id: 'chart-price',  arr: 'prices',      color: '#8b5cf6', bg: 'rgba(139,92,246,0.08)', label: 'Cijena', round: 1 },
  { id: 'chart-cons',   arr: 'consumption', color: '#0ea5e9', bg: 'rgba(14,165,233,0.08)',  label: 'Potrosnja', round: 2 },
  { id: 'chart-solar',  arr: 'solar',       color: '#f59e0b', bg: 'rgba(245,158,11,0.08)',  label: 'Solar', round: 2 },
  { id: 'chart-afrrp',  arr: 'aFRRplus',    color: '#10b981', bg: 'rgba(16,185,129,0.08)',  label: 'aFRR+', round: 2 },
  { id: 'chart-afrrm',  arr: 'aFRRminus',   color: '#f43f5e', bg: 'rgba(244,63,94,0.08)',   label: 'aFRR-', round: 2 },
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
      </button>`;
  });
}

function setDragMode(chartId, mode) {
  dragModes[chartId] = mode;
  renderDragToggles();
}

fetch('Input.json')
  .then(r => r.json())
  .then(data => {
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
  renderParams();
  renderDayTabs();
  renderCopySelects();
  renderDragToggles();
  renderHourlyTable(currentDay);
  buildAllCharts(currentDay);
}

function renderParams() {
  const grid = document.getElementById('param-grid');
  grid.innerHTML = PARAMS_DEF.map(p => `
    <div class="param-item">
      <div class="param-label">${p.label}</div>
      <input class="param-input" type="number" step="${p.step}"
        value="${state.parameters[p.key] ?? 0}"
        onchange="state.parameters['${p.key}'] = parseFloat(this.value) || 0">
      <div class="param-hint">${p.hint}</div>
    </div>
  `).join('');
}

function renderDayTabs() {
  const el = document.getElementById('day-tabs');
  el.innerHTML = DAYS.map((name, i) =>
    `<button class="tab-btn ${i===0?'active':''}" onclick="selectDay(${i})">${name}</button>`
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
    const ctx = document.getElementById(cfg.id).getContext('2d');
    const data = getDaySlice(cfg.arr, day);
    const origData = getOriginalDaySlice(cfg.arr, day);

    updateBadge(cfg.id, data);

    let dragStartValue = null;
    let dragStartData = null;

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
        pointHitRadius: 12,
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
        animation: { duration: 200 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          dragData: {
            round: cfg.round,
            showTooltip: true,
            dragX: false,
            onDragStart: (e, datasetIndex, index, value) => {
              if (datasetIndex !== 1) return false;
              dragStartValue = value;
              dragStartData = [...charts[cfg.id].data.datasets[1].data];
            },
            onDrag: (e, datasetIndex, index, value) => {
              if (datasetIndex !== 1) return false;
              const chart = charts[cfg.id];
              const mode = dragModes[cfg.id];
              if (mode === 'all' && dragStartData) {
                const delta = value - dragStartValue;
                const newData = dragStartData.map(v => {
                  let nv = Math.round((v + delta) * Math.pow(10, cfg.round)) / Math.pow(10, cfg.round);
                  return Math.max(0, nv);
                });
                chart.data.datasets[1].data = newData;
                chart.update('none');
                updateBadge(cfg.id, newData);
              } else {
                const liveData = [...chart.data.datasets[1].data];
                liveData[index] = value;
                updateBadge(cfg.id, liveData);
              }
            },
            onDragEnd: (e, datasetIndex, index, value) => {
              if (datasetIndex !== 1) return;
              const chart = charts[cfg.id];
              const mode = dragModes[cfg.id];
              const offset = currentDay * 24;
              if (mode === 'all' && dragStartData) {
                const delta = value - dragStartValue;
                const finalData = dragStartData.map(v => {
                  let nv = Math.round((v + delta) * Math.pow(10, cfg.round)) / Math.pow(10, cfg.round);
                  return Math.max(0, nv);
                });
                chart.data.datasets[1].data = finalData;
                chart.update('none');
                for (let h = 0; h < 24; h++) {
                  state[cfg.arr][offset + h] = finalData[h];
                  const inp = document.querySelector(`input[data-arr="${cfg.arr}"][data-idx="${offset + h}"]`);
                  if (inp) inp.value = finalData[h];
                }
                updateBadge(cfg.id, finalData);
              } else {
                const globalIdx = offset + index;
                state[cfg.arr][globalIdx] = value;
                const inp = document.querySelector(`input[data-arr="${cfg.arr}"][data-idx="${globalIdx}"]`);
                if (inp) inp.value = value;
                updateBadge(cfg.id, chart.data.datasets[1].data);
              }
              dragStartValue = null;
              dragStartData = null;
            }
          },
          tooltip: {
            ...tooltipStyle,
            filter: (item) => item.datasetIndex === 1,
            callbacks: {
              title: ctx => ctx[0].label,
              label: ctx => {
                const orig = charts[cfg.id].data.datasets[0].data[ctx.dataIndex];
                const diff = ctx.raw - orig;
                const diffStr = diff !== 0 ? ` (${diff > 0 ? '+' : ''}${diff.toFixed(cfg.round)})` : '';
                return `${cfg.label}: ${ctx.raw}${diffStr}`;
              }
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
    description: "Hourly electricity prices and factory consumption, 7 days x 24 hours",
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
