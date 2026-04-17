# ZET_simple — Claude Code Project Guide

## Overview

Battery Energy Storage System (BESS) optimisation tool for ZET.
Uses a MILP solver (HiGHS) to find the optimal weekly battery charge/discharge schedule
minimising electricity cost while honouring aFRR ancillary service commitments.

The project consists of:
- A Python optimisation engine (`main.py`)
- A local HTTP server (`server.py`) that serves the frontend and exposes two API endpoints
- A web dashboard (`dashboard.html`) for visualising results
- A web input editor (`input-editor.html`) for configuring parameters and hourly profiles

---

## Running the project

### Prerequisites
- Python environment with `highspy`, `numpy` (Anaconda recommended)
- Tested with `conda activate mojTestEnv`

### Start the server
```bash
# Navigate to the project folder first (important on Windows — cd alone won't switch drives)
cd /d D:\06_Programiranje\Claude\ZET_simple_v1

# Activate Anaconda environment (if not already active)
conda activate mojTestEnv

# Start the local server
python server.py
```

Then open:
- **Input Editor**: http://localhost:8002/input-editor.html
- **Dashboard**: http://localhost:8002/dashboard.html

### Run the optimisation directly
```bash
python main.py
```
Reads `Input.json`, writes `results.json`.

---

## File structure

```
ZET_simple_v1/
├── main.py               # HiGHS MILP optimisation engine
├── server.py             # Local HTTP server (port 8002)
├── Input.json            # Optimisation inputs (edit via input-editor or directly)
├── results.json          # Optimisation outputs (read by dashboard)
├── dashboard.html        # Results dashboard (HTML only, references external CSS/JS)
├── input-editor.html     # Input configuration editor (HTML only, references external CSS/JS)
├── css/
│   ├── dashboard.css     # Dashboard styles (Meridian design system)
│   └── input-editor.css  # Input editor styles (Meridian design system)
├── js/
│   ├── dashboard.js      # Dashboard logic (Chart.js charts, KPI cards, data table)
│   └── input-editor.js   # Editor logic (drag-to-edit charts, JSON import/export)
└── Images/
    └── Podravka_logo.png # Company logo used in header
```

---

## Server API endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/save-input` | Saves request JSON body to `Input.json` |
| POST | `/run-simulation` | Runs `main.py`, returns `{ ok, stdout, stderr }` |
| GET | `/*` | Serves static files from project directory |

---

## Design system (Meridian)

All UI files follow the same visual language. When adding new UI components, match this style — do not introduce new colours or fonts.

### Typography
- **DM Serif Display** — headings, card titles, serif accents
- **Outfit** — all UI text, labels, values, body copy

### Colours
- **Background**: warm cream `#f8f6f1`
- **Cards**: white `#ffffff`, with coloured `border-top` per category
- **Text dark**: `#1e293b`
- **Text muted**: `#94a3b8`
- **Border**: `rgba(232,228,222,0.8)`

| CSS variable | Hex | Typical use |
|---|---|---|
| `--cyan` | `#06b6d4` | General accent |
| `--amber` | `#f59e0b` | Solar, warnings |
| `--emerald` | `#10b981` | Savings, positive values |
| `--violet` | `#8b5cf6` | Prices, grid |
| `--rose` | `#f43f5e` | Errors, deficit, negative |
| `--blue-accent` | `#3b82f6` | Primary interactive accent |

### Header
- Deep blue gradient background
- Floating semi-transparent orbs (`::before` / `::after` pseudo-elements)
- Subtle grid texture overlay
- White/light text on dark background

### Cards & components
- `border-radius: 14px`, white background, light box-shadow
- Coloured `border-top: 3px solid var(--accent)` to categorise cards
- Hover: `transform: translateY(-2px)` + stronger shadow
- Active/selected: accent-coloured border + subtle gradient background
- Icons: Unicode characters inside small rounded containers with `background: rgba(accent, 0.1)`

### Animations
- `transition: all 0.3s ease` on interactive elements
- Charts: `animation: false` (instant updates for drag-to-edit responsiveness)

### Chart colours (consistent across dashboard and input-editor)
- Prices / grid: violet `#8b5cf6`
- Consumption: cyan `#0ea5e9`
- Solar: amber `#f59e0b`
- Battery charge: emerald `#10b981`
- Battery discharge: rose `#f43f5e`
- aFRR+: emerald, aFRR−: rose
- Curtailment / deficit: diagonal hatch pattern via Canvas API `createPattern()`

---

## Key implementation details

### Energy balance chart (dashboard)
- Chart.js 4.4.7 stacked bar chart
- All datasets use `stack: 'combined'` so positive and negative bars share a single column
- Dataset render order (bottom to top on screen): Solar → Mreza → Praznjenje → Manjak
- Negative bars: Punjenje (charge) and Export go below zero
- **Manjak (deficit)** uses a diagonal hatch pattern created via Canvas API `createPattern()` — not a solid colour

### Day names
- The optimiser outputs English day names (`Monday`, `Tuesday`, …)
- `dashboard.js` maps these to Croatian: `DAY_HR` object + `dayName()` / `dayShort()` helpers
- Short form = first 3 characters of the Croatian name (Pon, Uto, Sri, …)

### Savings calculation
Savings = cost without battery − optimised cost, where optimised cost accounts for export revenue:
```js
const costOpt = dayData.reduce((s,h) => s + h.price * h.grid - DATA.parameters.price_export * h.export, 0);
const costNoBat = dayData.reduce((s,h) => s + h.price * Math.max(h.consumption - h.solar, 0), 0);
```

### Input editor drag charts
- Uses `chartjs-plugin-dragdata` for drag-to-edit chart points
- Changes sync automatically to the hidden table (and vice versa)
- Drag mode can be toggled per-chart via the lock icon in each chart title

---

## Input.json structure

```json
{
  "parameters": {
    "E_bat": 2.0,           // Battery capacity [MWh]
    "P_bat": 0.5,           // Max charge/discharge power [MW]
    "eta_charge": 0.95,     // Charge efficiency
    "eta_discharge": 0.95,  // Discharge efficiency
    "soc_min": 0.15,        // Min SOC (fraction)
    "soc_max": 0.90,        // Max SOC (fraction)
    "soc_init": 0.50,       // Initial SOC (fraction)
    "P_grid_max": 2.0,      // Max grid import [MW]
    "P_export_max": 0.5,    // Max grid export [MW]
    "price_export": 40.0    // Export price [EUR/MWh]
  },
  "days": ["Monday", "Tuesday", ...],   // 7 strings
  "hourly": [                           // 168 rows (7 days × 24 hours)
    {
      "day": 0,             // Day index 0–6
      "hour": 0,            // Hour 0–23
      "price": 55.0,        // Electricity price [EUR/MWh]
      "consumption": 1.2,   // Load [MW]
      "solar": 0.0,         // Solar normalised output [0–1]
      "aFRRplus": 0.1,      // aFRR upward reserve [MW]
      "aFRRminus": 0.1      // aFRR downward reserve [MW]
    }
  ]
}
```

---

## results.json structure

```json
{
  "summary": {
    "cost_optimized": 1234.5,
    "savings": 234.5,
    "E_grid_total": 8.4,
    "E_solar_total": 3.2,
    "E_deficit_total": 0.0
  },
  "parameters": { ... },   // Echo of input parameters
  "days": ["Monday", ...],
  "hourly": [              // 168 rows
    {
      "day": 0, "hour": 0,
      "price": 55.0,
      "consumption": 1.2,
      "solar": 0.8,        // Actual solar output [MW] = solar_norm × P_solar_peak
      "grid": 0.4,         // Grid import [MW]
      "charge": 0.0,       // Battery charge [MW]
      "discharge": 0.0,    // Battery discharge [MW]
      "export": 0.0,       // Grid export [MW]
      "deficit": 0.0,      // Unmet demand [MW]
      "soc": 50.0,         // State of charge [%]
      "aFRRplus": 0.1,
      "aFRRminus": 0.1
    }
  ]
}
```

---

## Common issues

| Problem | Cause | Fix |
|---------|-------|-----|
| Dashboard shows no changes after editing CSS/JS | Browser cache | Ctrl+Shift+R to hard reload |
| "Spremi na disk" downloads to Downloads | Server not running | Start `server.py` first |
| `cd D:\...` doesn't work in Windows CMD | Drive switching | Use `cd /d D:\...` |
| `python` not found in PATH | Windows Store alias or missing PATH | Use Anaconda prompt or install Python with "Add to PATH" |
| Two-column stacked bars in Chart.js | Mixed `stack` names | All datasets must use the same `stack` value (e.g. `'combined'`) |
