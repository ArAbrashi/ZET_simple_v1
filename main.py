import json
import highspy

# Učitaj podatke
with open("Input.json", "r") as f:
    data = json.load(f)

prices = data["prices"]          # EUR/MWh
consumption = data["consumption"]  # MW
T = len(prices)                    # 168 sati (7 dana)

# Parametri baterije
P_bat = 0.5    # MW - max snaga punjenja/pražnjenja
E_bat = 50.0   # MWh - kapacitet baterije
SOC_init = 0.0 # % - početno stanje napunjenosti (0-100%)

# Kreiranje HiGHS modela
h = highspy.Highs()
h.silent()

inf = highspy.kHighsInf

# Varijable (sve kontinuirane, lower bound, upper bound):
#   p_grid[t]      - snaga s mreže [0, inf)         t = 0..T-1
#   p_charge[t]    - snaga punjenja baterije [0, P_bat]  t = 0..T-1
#   p_discharge[t] - snaga pražnjenja baterije [0, P_bat] t = 0..T-1
#   soc[t]         - stanje napunjenosti [0, 100] %       t = 0..T-1

num_vars = 4 * T
col_lower = []
col_upper = []
col_cost = []

# Indeksi varijabli
def idx_grid(t):      return t
def idx_charge(t):    return T + t
def idx_discharge(t): return 2 * T + t
def idx_soc(t):       return 3 * T + t

for t in range(T):
    # p_grid[t]
    col_lower.append(0.0)
    col_upper.append(inf)
    col_cost.append(prices[t])  # minimiziramo trošak: cijena * snaga_s_mreže * 1h

    # p_charge[t]
    col_lower.append(0.0)
    col_upper.append(P_bat)
    col_cost.append(0.0)

    # p_discharge[t]
    col_lower.append(0.0)
    col_upper.append(P_bat)
    col_cost.append(0.0)

    # soc[t] u postocima (0-100%)
    col_lower.append(0.0)
    col_upper.append(100.0)
    col_cost.append(0.0)

h.addVars(num_vars, col_lower, col_upper)

# Postavi funkciju cilja (minimize)
h.changeColsCostByRange(0, num_vars - 1, col_cost)
h.changeObjectiveSense(highspy.ObjSense.kMinimize)

# Ograničenja:

# 1) Energetska ravnoteža: p_grid[t] + p_discharge[t] - p_charge[t] = consumption[t]
for t in range(T):
    indices = [idx_grid(t), idx_discharge(t), idx_charge(t)]
    values = [1.0, 1.0, -1.0]
    h.addRow(consumption[t], consumption[t], len(indices), indices, values)

# 2) Dinamika SOC-a: soc[t] (%) = soc[t-1] (%) + (p_charge[t] - p_discharge[t]) / E_bat * 100
#    => soc[t] - (100/E_bat)*p_charge[t] + (100/E_bat)*p_discharge[t] = soc[t-1]
pct_factor = 100.0 / E_bat  # pretvorba MW*1h -> % kapaciteta
for t in range(T):
    soc_prev = SOC_init if t == 0 else None
    if t == 0:
        indices = [idx_soc(t), idx_charge(t), idx_discharge(t)]
        values = [1.0, -pct_factor, pct_factor]
        h.addRow(soc_prev, soc_prev, len(indices), indices, values)
    else:
        indices = [idx_soc(t), idx_soc(t - 1), idx_charge(t), idx_discharge(t)]
        values = [1.0, -1.0, -pct_factor, pct_factor]
        h.addRow(0.0, 0.0, len(indices), indices, values)

# Rješavanje
h.run()

status = h.getInfoValue("primal_solution_status")[1]
if status == 2:  # feasible
    obj = h.getInfoValue("objective_function_value")[1]
    sol = h.getSolution().col_value

    print(f"Optimalni tjedni trošak: {obj:,.2f} EUR")
    print(f"Trošak bez baterije:     {sum(p * c for p, c in zip(prices, consumption)):,.2f} EUR")
    print(f"Ušteda:                  {sum(p * c for p, c in zip(prices, consumption)) - obj:,.2f} EUR")
    print()

    for day in range(7):
        day_name = data["days"][day]
        start = day * 24
        end = start + 24
        day_cost = sum(prices[t] * sol[idx_grid(t)] for t in range(start, end))
        day_grid = sum(sol[idx_grid(t)] for t in range(start, end))
        print(f"{day_name:12s} | Mreža: {day_grid:6.1f} MWh | Trošak: {day_cost:8.2f} EUR | "
              f"SOC kraj: {sol[idx_soc(end - 1)]:.1f}%")

    print("\nDetaljni sat-po-sat (prvi dan):")
    print(f"{'Sat':>4} | {'Cijena':>8} | {'Potražnja':>9} | {'Mreža':>7} | {'Punjenje':>8} | {'Pražnj.':>8} | {'SOC %':>6}")
    print("-" * 72)
    for t in range(24):
        print(f"{t:4d} | {prices[t]:7.1f}  | {consumption[t]:8.1f}  | {sol[idx_grid(t)]:6.2f}  | "
              f"{sol[idx_charge(t)]:7.2f}  | {sol[idx_discharge(t)]:7.2f}  | {sol[idx_soc(t)]:5.1f}%")
else:
    print("Model nije pronašao izvedivo rješenje!")
