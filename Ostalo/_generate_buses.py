"""
Generates 48 synthetic bus charging profiles based on two reference profiles
from Demand BUS.csv. Output: Demand_BUS_50.xlsx (original 2 + 48 new = 50 columns)
"""
import numpy as np
import pandas as pd

SLOTS_PER_DAY = 96
N_DAYS = 14
N = N_DAYS * SLOTS_PER_DAY
DT = 0.25  # h per slot

# ── 1. Load originals ────────────────────────────────────────────────────────
data = []
with open("Demand BUS.csv", encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if line:
            a, b = line.split(";")
            data.append((float(a.replace(",", ".")), float(b.replace(",", "."))))

bus1 = np.array([d[0] for d in data])   # shape (1344,)
bus2 = np.array([d[1] for d in data])

b1d = bus1.reshape(N_DAYS, SLOTS_PER_DAY)  # shape (14, 96)
b2d = bus2.reshape(N_DAYS, SLOTS_PER_DAY)

e1_day = b1d.sum(axis=1) * DT   # MWh per day, Bus 1
e2_day = b2d.sum(axis=1) * DT   # MWh per day, Bus 2

print(f"Bus 1 total: {e1_day.sum():.2f} MWh  |  daily avg: {e1_day.mean():.2f} MWh")
print(f"Bus 2 total: {e2_day.sum():.2f} MWh  |  daily avg: {e2_day.mean():.2f} MWh")

# ── 2. Generate 48 new profiles ──────────────────────────────────────────────
rng = np.random.default_rng(seed=2024)
N_NEW = 48

# Group assignment:
#  - 20 buses: night-heavy (like Bus 1, smaller total)
#  - 20 buses: longer night + some day (like Bus 2, larger total)
#  - 8 buses: "unusual" — daytime only or irregular (outliers as requested)

groups = (
    [("night_only",  0)] * 20 +   # based on Bus 1 pattern
    [("full",        1)] * 20 +   # based on Bus 2 pattern
    [("outlier",    -1)] *  8     # custom
)
rng.shuffle(groups)

generated = np.zeros((N, N_NEW))

for bus_idx, (group, template_id) in enumerate(groups):

    if group == "outlier":
        # ── Outlier buses: daytime charging or afternoon/morning only ──
        new_bus = np.zeros((N_DAYS, SLOTS_PER_DAY))
        outlier_type = rng.choice(["day_only", "morning", "split", "late_evening"])
        scale = rng.uniform(0.6, 1.4)

        for d in range(N_DAYS):
            # Pick random energy close to Bus 1 average
            target_e = e1_day[d] * scale if e1_day[d] > 0.01 else 0.0
            if target_e < 0.01:
                continue

            if outlier_type == "day_only":
                # Charge 10:00–16:00 (slots 40–64)
                start = rng.integers(36, 45)
                dur   = rng.integers(16, 28)
            elif outlier_type == "morning":
                # Charge 05:00–10:00 (slots 20–40)
                start = rng.integers(18, 22)
                dur   = rng.integers(10, 20)
            elif outlier_type == "split":
                # Short night + afternoon top-up (simulate two sessions)
                start = rng.integers(84, 92)
                dur   = rng.integers(8, 14)
            else:  # late_evening
                # 20:00–02:00
                start = rng.integers(78, 86)
                dur   = rng.integers(16, 28)

            end = start + dur
            profile = np.zeros(SLOTS_PER_DAY)
            # Trapezoidal ramp-up/ramp-down
            ramp = min(3, dur // 4)
            for s in range(dur):
                slot = (start + s) % SLOTS_PER_DAY
                ramp_factor = min(1.0, (s + 1) / max(ramp, 1),
                                       (dur - s) / max(ramp, 1))
                profile[slot] = ramp_factor

            # Scale to target energy
            cur_e = profile.sum() * DT
            if cur_e > 0:
                profile = profile * (target_e / cur_e)

            # Add small noise
            noise_mask = profile > 0
            profile[noise_mask] += rng.normal(0, 0.02, noise_mask.sum())
            profile = np.clip(profile, 0, None)

            new_bus[d] = profile

    else:
        # ── Regular buses: based on one of the two templates ──
        source = b1d if template_id == 0 else b2d
        src_e  = e1_day if template_id == 0 else e2_day

        # Random parameters
        scale       = rng.uniform(0.80, 1.25)
        time_shift  = int(rng.integers(-10, 11))  # ±2.5 h
        remove_day  = (group == "night_only") and (rng.random() < 0.5)
        power_noise = rng.uniform(0.03, 0.10)

        new_bus = np.zeros((N_DAYS, SLOTS_PER_DAY))
        for d in range(N_DAYS):
            profile = source[d].copy()

            # Shift in time
            if time_shift != 0:
                profile = np.roll(profile, time_shift)

            # Optionally remove daytime window (slots 28–79 = 07:00–20:00)
            if remove_day:
                profile[28:80] = 0.0

            # Multiplicative noise on active slots (keeps shape, varies power)
            active = profile > 0
            if active.any():
                mult = 1.0 + rng.normal(0, power_noise, active.sum())
                mult = np.clip(mult, 0.6, 1.4)
                profile[active] *= mult

            profile = np.clip(profile, 0, None)

            # Re-scale to target energy
            cur_e = profile.sum() * DT
            tgt_e = src_e[d] * scale
            if cur_e > 1e-6 and tgt_e > 1e-6:
                profile = profile * (tgt_e / cur_e)

            new_bus[d] = profile

    generated[:, bus_idx] = new_bus.flatten()

# ── 3. Summary ───────────────────────────────────────────────────────────────
print("\nGenerated bus energies (MWh over 14 days):")
for i in range(N_NEW):
    e = generated[:, i].sum() * DT
    print(f"  Bus {i+3:3d}  {e:6.2f} MWh  ({groups[i][0]})")

totals = [generated[:, i].sum() * DT for i in range(N_NEW)]
print(f"\nAll 48 buses — min: {min(totals):.2f}  max: {max(totals):.2f}  avg: {np.mean(totals):.2f} MWh")

# ── 4. Write Excel ────────────────────────────────────────────────────────────
cols = [f"BUS_{i+1:02d}" for i in range(2)] + [f"BUS_{i+3:02d}" for i in range(N_NEW)]

all_data = np.column_stack([bus1, bus2, generated])
df = pd.DataFrame(all_data, columns=cols)

# Slot index column
slot_idx  = np.arange(N)
day_idx   = slot_idx // SLOTS_PER_DAY
hour_in_day = (slot_idx % SLOTS_PER_DAY) * DT
df.insert(0, "Day",  day_idx + 1)
df.insert(1, "Hour", np.round(hour_in_day, 4))

out_path = "Demand_BUS_50.xlsx"
with pd.ExcelWriter(out_path, engine="openpyxl") as writer:
    df.to_excel(writer, index=False, sheet_name="Profiles")

    # Summary sheet
    summary_rows = []
    summary_rows.append({"Bus": "BUS_01 (original)", "Total_MWh": round(bus1.sum() * DT, 3),
                          "Peak_MW": round(bus1.max(), 3), "Group": "original"})
    summary_rows.append({"Bus": "BUS_02 (original)", "Total_MWh": round(bus2.sum() * DT, 3),
                          "Peak_MW": round(bus2.max(), 3), "Group": "original"})
    for i in range(N_NEW):
        col = generated[:, i]
        summary_rows.append({
            "Bus": f"BUS_{i+3:02d}",
            "Total_MWh": round(col.sum() * DT, 3),
            "Peak_MW":   round(col.max(), 3),
            "Group":     groups[i][0],
        })
    pd.DataFrame(summary_rows).to_excel(writer, index=False, sheet_name="Summary")

print(f"\nSaved: {out_path}")
