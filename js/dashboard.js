let DATA = null;
let energyChart = null, socChart = null, priceChart = null;
let selectedDay = 0;

// Chart.js global theme
Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = 'rgba(232,228,222,0.6)';
Chart.defaults.font.family = 'Outfit';

fetch('results.json')
  .then(r => r.json())
  .then(data => { DATA = data; init(); })
  .catch(() => {
    document.querySelector('.container').innerHTML =
      '<div style="text-align:center;padding:80px 24px;">'+
      '<p style="font-family:DM Serif Display,serif;font-size:1.6rem;color:var(--text-dark);margin-bottom:12px;">Podaci nisu dostupni</p>'+
      '<p style="color:var(--text-muted);font-size:0.95rem;">Pokrenite <code style="background:rgba(59,130,246,0.08);padding:3px 8px;border-radius:6px;color:var(--blue-accent);">python main.py</code> za generiranje rezultata.</p></div>';
  });

const DAY_HR = {
  'Monday': 'Ponedjeljak', 'Tuesday': 'Utorak', 'Wednesday': 'Srijeda',
  'Thursday': 'Cetvrtak', 'Friday': 'Petak', 'Saturday': 'Subota', 'Sunday': 'Nedjelja'
};
function dayName(eng) { return DAY_HR[eng] || eng; }
function dayShort(eng) { return (DAY_HR[eng] || eng).substring(0, 3); }

function createHatchPattern() {
  const size = 8;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(210,210,210,0.18)';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(160,160,160,0.55)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, size);
  ctx.lineTo(size, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-size, size);
  ctx.lineTo(size, -size);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, 2 * size);
  ctx.lineTo(2 * size, 0);
  ctx.stroke();
  return ctx.createPattern(canvas, 'repeat');
}

function fmt(n, d=2) {
  return n.toLocaleString('de-DE', {minimumFractionDigits:d, maximumFractionDigits:d});
}

function init() {
  renderKPI();
  renderDailyCards();
  renderTabs();
  renderCharts(selectedDay);
  renderTable(selectedDay);
}

function renderKPI() {
  const s = DATA.summary;
  const cards = [
    { label: 'Optimalni trosak', value: fmt(s.cost_optimized,0), unit: 'EUR / tjedan', cls: 'cyan', icon: '&#9670;' },
    { label: 'Usteda', value: fmt(s.savings,0), unit: 'EUR vs. bez baterije', cls: 'emerald', icon: '&#9650;' },
    { label: 'Mreza', value: fmt(s.E_grid_total,1), unit: 'MWh ukupno', cls: 'violet', icon: '&#9889;' },
    { label: 'Solar', value: fmt(s.E_solar_total,1), unit: 'MWh proizvedeno', cls: 'amber', icon: '&#9728;' },
    { label: 'Manjak EE', value: fmt(s.E_deficit_total,2), unit: 'MWh nenamireno', cls: s.E_deficit_total > 0.01 ? 'rose' : 'emerald', icon: '&#9888;' },
  ];
  const grid = document.getElementById('kpi-grid');
  grid.innerHTML = cards.map(c => `
    <div class="kpi-card ${c.cls}">
      <div class="kpi-icon">${c.icon}</div>
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-value">${c.value}</div>
      <div class="kpi-unit">${c.unit}</div>
    </div>
  `).join('');
}

function renderDailyCards() {
  const grid = document.getElementById('daily-grid');
  grid.innerHTML = DATA.days.map((name, i) => {
    const dayData = DATA.hourly.filter(h => h.day === i);
    const costOpt = dayData.reduce((s,h) => s + h.price * h.grid - DATA.parameters.price_export * h.export, 0);
    const costNoBat = dayData.reduce((s,h) => s + h.price * Math.max(h.consumption - h.solar, 0), 0);
    const cost = costOpt;
    const savings = costNoBat - costOpt;
    const gridMwh = dayData.reduce((s,h) => s + h.grid, 0);
    return `
      <div class="daily-card ${i===0?'active':''}" onclick="selectDay(${i})">
        <div class="day-name">${dayName(name)}</div>
        <div class="day-cost">${fmt(cost,0)} EUR</div>
        <div class="day-savings">usteda ${fmt(savings,0)} EUR</div>
        <div class="day-grid-mwh">${fmt(gridMwh,1)} MWh mreza</div>
      </div>`;
  }).join('');
}

function renderTabs() {
  ['energy-tabs', 'table-tabs'].forEach(id => {
    const el = document.getElementById(id);
    el.innerHTML = DATA.days.map((name, i) =>
      `<button class="day-tab ${i===0?'active':''}" data-day="${i}" onclick="selectDay(${i})">${dayShort(name)}</button>`
    ).join('') + `<button class="day-tab" data-day="all" onclick="selectDay('all')">Svi</button>`;
  });
}

function selectDay(day) {
  selectedDay = day;
  document.querySelectorAll('.day-tab').forEach(t => t.classList.toggle('active',
    t.dataset.day === String(day)));
  document.querySelectorAll('.daily-card').forEach((c,i) =>
    c.classList.toggle('active', day === i));
  renderCharts(day);
  renderTable(day);
}

function getSlice(day) {
  if (day === 'all') return DATA.hourly;
  return DATA.hourly.filter(h => h.day === day);
}

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

function renderCharts(day) {
  const slice = getSlice(day);
  const labels = slice.map(h => day === 'all' ? `${dayShort(DATA.days[h.day])} ${h.hour}h` : `${h.hour}:00`);
  const pctFactor = 100 / DATA.parameters.E_bat;

  // Energy Balance
  if (energyChart) energyChart.destroy();
  energyChart = new Chart(document.getElementById('energyChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Manjak', data: slice.map(h=>h.deficit), backgroundColor: createHatchPattern(), borderColor: 'rgba(160,160,160,0.5)', borderWidth: 1, stack: 'combined', order: 4, borderRadius: 3 },
        { label: 'Praznjenje', data: slice.map(h=>h.discharge * DATA.parameters.eta_discharge), backgroundColor: 'rgba(244,63,94,0.55)', stack: 'combined', order: 3, borderRadius: 3 },
        { label: 'Mreza', data: slice.map(h=>h.grid), backgroundColor: 'rgba(59,130,246,0.65)', stack: 'combined', order: 2, borderRadius: 3 },
        { label: 'Solar', data: slice.map(h=>h.solar), backgroundColor: 'rgba(245,158,11,0.65)', stack: 'combined', order: 1, borderRadius: 3 },
        { label: 'Punjenje', data: slice.map(h=>-h.charge), backgroundColor: 'rgba(16,185,129,0.6)', stack: 'combined', order: 5, borderRadius: 3 },
        { label: 'Export', data: slice.map(h=>-h.export), backgroundColor: 'rgba(56,189,248,0.55)', stack: 'combined', order: 6, borderRadius: 3 },
        { label: 'Potrosnja', data: slice.map(h=>h.consumption), type: 'line',
          borderColor: '#1e293b', borderWidth: 2, borderDash: [6,3],
          pointRadius: 0, fill: false, stack: false, order: -1 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#64748b', font: { family: 'Outfit', size: 12 }, boxWidth: 14, padding: 18, usePointStyle: true, pointStyle: 'rectRounded' } },
        tooltip: { ...tooltipStyle, callbacks: { label: ctx => `${ctx.dataset.label}: ${Math.abs(ctx.raw).toFixed(2)} MW` } }
      },
      scales: {
        x: { grid: { color: 'rgba(232,228,222,0.5)' }, ticks: { color: '#94a3b8', font: { family: 'Outfit', size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 24 } },
        y: { grid: { color: 'rgba(232,228,222,0.5)' }, ticks: { color: '#94a3b8', font: { family: 'Outfit', size: 11 } }, title: { display: true, text: 'Snaga [MW]', color: '#94a3b8', font: { family: 'DM Serif Display', size: 13 } } }
      }
    }
  });

  // SOC Chart
  if (socChart) socChart.destroy();
  const socLower = slice.map(h => 15 + h.aFRRplus * pctFactor);
  const socUpper = slice.map(h => 90 - h.aFRRminus * pctFactor);
  socChart = new Chart(document.getElementById('socChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'SOC', data: slice.map(h=>h.soc), borderColor: '#f97316', backgroundColor: 'rgba(249,115,22,0.08)',
          borderWidth: 2.5, pointRadius: 0, fill: true, tension: 0.2 },
        { label: 'Min (aFRR+)', data: socLower, borderColor: '#f43f5e', borderWidth: 1.5,
          borderDash: [5,4], pointRadius: 0, fill: false },
        { label: 'Max (aFRR-)', data: socUpper, borderColor: '#10b981', borderWidth: 1.5,
          borderDash: [5,4], pointRadius: 0, fill: false },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#64748b', font: { family: 'Outfit', size: 12 }, boxWidth: 14, usePointStyle: true } },
        tooltip: { ...tooltipStyle, callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.raw.toFixed(1)}%` } }
      },
      scales: {
        x: { grid: { color: 'rgba(232,228,222,0.5)' }, ticks: { color: '#94a3b8', font: { family: 'Outfit', size: 11 }, maxRotation: 0, autoSkip: true } },
        y: { min: 0, max: 100, grid: { color: 'rgba(232,228,222,0.5)' }, ticks: { color: '#94a3b8', font: { family: 'Outfit', size: 11 }, callback: v => v+'%' } }
      }
    }
  });

  // Price Chart
  if (priceChart) priceChart.destroy();
  priceChart = new Chart(document.getElementById('priceChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Cijena EE',
        data: slice.map(h=>h.price),
        borderColor: '#8b5cf6',
        backgroundColor: 'rgba(139,92,246,0.06)',
        borderWidth: 2.5,
        pointRadius: 0,
        fill: true,
        tension: 0.25,
        segment: {
          borderColor: ctx => {
            const v = ctx.p1.parsed.y;
            return v > 80 ? '#f43f5e' : v > 60 ? '#f97316' : '#8b5cf6';
          }
        }
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#64748b', font: { family: 'Outfit', size: 12 }, boxWidth: 14, usePointStyle: true } },
        tooltip: { ...tooltipStyle, callbacks: { label: ctx => `${ctx.raw.toFixed(1)} EUR/MWh` } }
      },
      scales: {
        x: { grid: { color: 'rgba(232,228,222,0.5)' }, ticks: { color: '#94a3b8', font: { family: 'Outfit', size: 11 }, maxRotation: 0, autoSkip: true } },
        y: { grid: { color: 'rgba(232,228,222,0.5)' }, ticks: { color: '#94a3b8', font: { family: 'Outfit', size: 11 } }, title: { display: true, text: 'EUR/MWh', color: '#94a3b8', font: { family: 'DM Serif Display', size: 13 } } }
      }
    }
  });
}

function renderTable(day) {
  const slice = getSlice(day);
  const tbody = document.getElementById('table-body');
  tbody.innerHTML = slice.map(h => `<tr>
    <td>${day==='all' ? dayShort(DATA.days[h.day])+' '+h.hour+'h' : h.hour+':00'}</td>
    <td>${h.price.toFixed(1)}</td>
    <td>${h.consumption.toFixed(2)}</td>
    <td class="val-solar">${h.solar.toFixed(2)}</td>
    <td class="val-grid">${h.grid.toFixed(2)}</td>
    <td class="val-charge">${h.charge.toFixed(2)}</td>
    <td class="val-discharge">${h.discharge.toFixed(2)}</td>
    <td>${h.export.toFixed(2)}</td>
    <td class="${h.deficit>0.001?'val-deficit':''}">${h.deficit.toFixed(2)}</td>
    <td>${h.aFRRplus.toFixed(1)}</td>
    <td>${h.aFRRminus.toFixed(1)}</td>
    <td class="val-soc">${h.soc.toFixed(1)}%</td>
  </tr>`).join('');
}
