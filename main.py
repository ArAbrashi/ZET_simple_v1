import json
import numpy as np
import highspy
import matplotlib.pyplot as plt

# Učitaj podatke
with open("Input.json", "r") as f:
    data = json.load(f)

prices = data["prices"]             # EUR/MWh
consumption = data["consumption"]   # MW
aFRRplus = data["aFRRplus"]         # MW - ponuđena snaga pozitivne regulacije
aFRRminus = data["aFRRminus"]      # MW - ponuđena snaga negativne regulacije
solar_norm = data["solar"]          # kW - normalizirani profil solarne elektrane (1 kW inst.)
T = len(prices)                     # 168 sati (7 dana)

# Parametri iz JSON-a
params = data["parameters"]
P_bat = params["P_bat"]                     # MW - max snaga punjenja/pražnjenja
E_bat = params["E_bat"]                     # MWh - kapacitet baterije
SOC_init = params["SOC_init"]               # % - početno stanje napunjenosti (0-100%)
P_grid_max = params["P_grid_max"]           # MW - max snaga povlačenja iz mreže
PENALTY_DEFICIT = params["PENALTY_DEFICIT"] # EUR/MWh - kazneni trošak za manjak EE
P_solar_inst = params["P_solar_installed"]  # MW - instalirana snaga solarne elektrane

# Stvarna solarna proizvodnja u MW (normalizirani profil 0-1 * instalirana snaga u MW)
solar_prod = [s * P_solar_inst for s in solar_norm]  # MW

# Kreiranje HiGHS modela
h = highspy.Highs()
verbose = params.get("verbose", False)
if verbose:
    h.setOptionValue("output_flag", True)
else:
    h.setOptionValue("output_flag", False)

inf = highspy.kHighsInf

# Varijable (sve kontinuirane, lower bound, upper bound):
#   p_grid[t]      - snaga s mreže [0, P_grid_max]            t = 0..T-1
#   p_charge[t]    - snaga punjenja baterije [0, P_bat]       t = 0..T-1
#   p_discharge[t] - snaga pražnjenja baterije [0, P_bat]     t = 0..T-1
#   soc[t]         - stanje napunjenosti [15, 90] %           t = 0..T-1
#   p_deficit[t]   - manjak EE [0, inf) MW                    t = 0..T-1
#   p_curtail[t]   - curtailment solarne el. [0, solar_prod]  t = 0..T-1

num_vars = 6 * T
col_lower = []
col_upper = []
col_cost = []

# Indeksi varijabli - grupirani po satu:
#   t=0: [grid_0, charge_0, discharge_0, soc_0], t=1: [grid_1, charge_1, ...], ...
N_VAR_PER_T = 6
def idx_grid(t):      return N_VAR_PER_T * t
def idx_charge(t):    return N_VAR_PER_T * t + 1
def idx_discharge(t): return N_VAR_PER_T * t + 2
def idx_soc(t):       return N_VAR_PER_T * t + 3
def idx_deficit(t):   return N_VAR_PER_T * t + 4
def idx_curtail(t):   return N_VAR_PER_T * t + 5

for t in range(T):
    # p_grid[t]
    col_lower.append(0.0)
    col_upper.append(P_grid_max)
    col_cost.append(prices[t])  # minimiziramo trošak: cijena * snaga_s_mreže * 1h

    # p_charge[t]
    col_lower.append(0.0)
    col_upper.append(P_bat)
    col_cost.append(0.0)

    # p_discharge[t]
    col_lower.append(0.0)
    col_upper.append(P_bat)
    col_cost.append(0.0)

    # soc[t] u postocima (15-90%)
    col_lower.append(15.0)
    col_upper.append(90.0)
    col_cost.append(0.0)

    # p_deficit[t] - manjak EE, s visokim kaznenim troškom
    col_lower.append(0.0)
    col_upper.append(inf)
    col_cost.append(PENALTY_DEFICIT)

    # p_curtail[t] - curtailment solarne elektrane [0, solar_prod[t]]
    col_lower.append(0.0)
    col_upper.append(solar_prod[t])
    col_cost.append(0.0)

h.addVars(num_vars, col_lower, col_upper)

# Postavi funkciju cilja (minimize)
for i in range(num_vars):
    h.changeColCost(i, col_cost[i])
h.changeObjectiveSense(highspy.ObjSense.kMinimize)

# Ograničenja:

# 1) Energetska ravnoteža:
#    p_grid + p_discharge - p_charge - p_curtail + p_deficit = consumption - solar_prod
for t in range(T):
    rhs = consumption[t] - solar_prod[t]
    indices = [idx_grid(t), idx_discharge(t), idx_charge(t), idx_curtail(t), idx_deficit(t)]
    values = [1.0, 1.0, -1.0, -1.0, 1.0]
    h.addRow(rhs, rhs, len(indices), indices, values)

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

# 3) Max snaga pražnjenja ovisi o SOC-u (konkavna funkcija -> LP bez binarnih varijabli):
#    SOC 0-50%:   P_dis_max = P_bat * SOC / 50        (linearni rast)
#    SOC 50-85%:  P_dis_max = P_bat                    (konstantno)
#    SOC 85-100%: P_dis_max = P_bat - 0.4*P_bat*(SOC-85)/15  (linearni pad do 60% P_bat)
#
#    Kako je funkcija konkavna, dovoljno je nametnuti sva 3 linearna ograničenja
#    istovremeno - najstroži automatski vrijedi u svakom segmentu.
for t in range(T):
    # Segment 1: p_discharge <= P_bat/50 * SOC
    #   => p_discharge - (P_bat/50)*soc <= 0
    indices = [idx_discharge(t), idx_soc(t)]
    values = [1.0, -P_bat / 50.0]
    h.addRow(-inf, 0.0, len(indices), indices, values)

    # Segment 2: p_discharge <= P_bat  (već osigurano gornjom granicom varijable)

    # Segment 3: p_discharge <= P_bat - 0.4*P_bat*(SOC - 85)/15
    #   => p_discharge + (0.4*P_bat/15)*soc <= P_bat + 0.4*P_bat*85/15
    slope3 = 0.4 * P_bat / 15.0
    rhs3 = P_bat + slope3 * 85.0
    indices = [idx_discharge(t), idx_soc(t)]
    values = [1.0, slope3]
    h.addRow(-inf, rhs3, len(indices), indices, values)

# 4) Rezervacija kapaciteta za aFRR regulaciju uz SOC-ovisnu snagu:
#    aFRR+: (p_discharge + aFRRplus) mora poštovati istu SOC-ovisnu krivulju kao p_discharge
#      Segment 1: p_discharge + aFRRplus <= P_bat/50 * SOC
#        => p_discharge - (P_bat/50)*SOC <= -aFRRplus[t]
#      Segment 2: p_discharge + aFRRplus <= P_bat
#        => p_discharge <= P_bat - aFRRplus[t]
#      Segment 3: p_discharge + aFRRplus <= P_bat - 0.4*P_bat*(SOC-85)/15
#        => p_discharge + (0.4*P_bat/15)*SOC <= P_bat + 0.4*P_bat*85/15 - aFRRplus[t]
#
#    aFRR-: baterija mora imati rezervu za dodatno punjenje
#      p_charge + aFRRminus <= P_bat
#        => p_charge <= P_bat - aFRRminus[t]
for t in range(T):
    # aFRR+ segment 1: p_discharge - (P_bat/50)*SOC <= -aFRRplus[t]
    indices = [idx_discharge(t), idx_soc(t)]
    values = [1.0, -P_bat / 50.0]
    h.addRow(-inf, -aFRRplus[t], len(indices), indices, values)

    # aFRR+ segment 2: p_discharge <= P_bat - aFRRplus[t]
    indices = [idx_discharge(t)]
    values = [1.0]
    h.addRow(-inf, P_bat - aFRRplus[t], len(indices), indices, values)

    # aFRR+ segment 3: p_discharge + slope3*SOC <= rhs3 - aFRRplus[t]
    slope3 = 0.4 * P_bat / 15.0
    rhs3 = P_bat + slope3 * 85.0
    indices = [idx_discharge(t), idx_soc(t)]
    values = [1.0, slope3]
    h.addRow(-inf, rhs3 - aFRRplus[t], len(indices), indices, values)

    # aFRR- rezerva na punjenju: p_charge <= P_bat - aFRRminus[t]
    indices = [idx_charge(t)]
    values = [1.0]
    h.addRow(-inf, P_bat - aFRRminus[t], len(indices), indices, values)

# Rješavanje
h.run()

status = h.getInfoValue("primal_solution_status")[1]
if status == 2:  # feasible
    obj = h.getInfoValue("objective_function_value")[1]
    sol = h.getSolution().col_value

    # Ukupne energije
    E_grid_total = sum(max(0.0, sol[idx_grid(t)]) for t in range(T))
    E_deficit_total = sum(max(0.0, sol[idx_deficit(t)]) for t in range(T))
    E_solar_total = sum(solar_prod)
    E_curtail_total = sum(max(0.0, sol[idx_curtail(t)]) for t in range(T))

    print(f"Ukupno preuzeto iz mreže: {E_grid_total:,.2f} MWh")
    print(f"Ukupna potrošnja:         {sum(consumption):,.2f} MWh")
    print(f"Solarna proizvodnja:      {E_solar_total:,.2f} MWh")
    print(f"Curtailment solara:       {E_curtail_total:,.2f} MWh")
    print(f"Ukupni manjak EE:         {E_deficit_total:,.2f} MWh")
    print(f"Optimalni tjedni trošak:  {obj:,.2f} EUR")
    print(f"Trošak bez baterije:      {sum(p * c for p, c in zip(prices, consumption)):,.2f} EUR")
    print(f"Ušteda:                   {sum(p * c for p, c in zip(prices, consumption)) - obj:,.2f} EUR")
    print()

    for day in range(7):
        day_name = data["days"][day]
        start = day * 24
        end = start + 24
        day_cost = sum(prices[t] * sol[idx_grid(t)] for t in range(start, end))
        day_grid = sum(sol[idx_grid(t)] for t in range(start, end))
        print(f"{day_name:12s} | Mreža: {day_grid:6.1f} MWh | Trošak: {day_cost:8.2f} EUR | "
              f"SOC kraj: {sol[idx_soc(end - 1)]:.1f}%")

    for day in range(7):
        day_name = data["days"][day]
        start = day * 24
        end = start + 24
        print(f"\nDetaljni sat-po-sat ({day_name}):")
        print(f"{'Sat':>4} | {'Cijena':>8} | {'Potraž.':>7} | {'Solar':>5} | {'Mreža':>6} | {'Punj.':>6} | {'Praž.':>6} | {'Curt.':>5} | {'Manj.':>6} | {'aFRR+':>5} | {'aFRR-':>5} | {'SOC %':>6}")
        print("-" * 110)
        for t in range(start, end):
            v_grid = max(0.0, sol[idx_grid(t)])
            v_chg  = max(0.0, sol[idx_charge(t)])
            v_dis  = max(0.0, sol[idx_discharge(t)])
            v_def  = max(0.0, sol[idx_deficit(t)])
            v_cur  = max(0.0, sol[idx_curtail(t)])
            v_soc  = sol[idx_soc(t)]
            print(f"{t - start:4d} | {prices[t]:7.1f}  | {consumption[t]:6.1f}  | {solar_prod[t]:4.2f}  | {v_grid:5.2f}  | "
                  f"{v_chg:5.2f}  | {v_dis:5.2f}  | {v_cur:4.2f}  | {v_def:5.2f}  | {aFRRplus[t]:4.1f}  | {aFRRminus[t]:4.1f}  | {v_soc:5.1f}%")
    # Dijagram za ponedjeljak + utorak (48 sati)
    H = 48
    hours = list(range(H))

    d_grid = np.array([max(0.0, sol[idx_grid(t)]) for t in range(H)])
    d_chg  = np.array([max(0.0, sol[idx_charge(t)]) for t in range(H)])
    d_dis  = np.array([max(0.0, sol[idx_discharge(t)]) for t in range(H)])
    d_def  = np.array([max(0.0, sol[idx_deficit(t)]) for t in range(H)])
    d_cur  = np.array([max(0.0, sol[idx_curtail(t)]) for t in range(H)])
    d_sol  = np.array(solar_prod[:H])
    d_soc  = np.array([sol[idx_soc(t)] for t in range(H)])
    d_price = np.array(prices[:H])
    d_cons = np.array(consumption[:H])
    d_afrr_p = np.array(aFRRplus[:H])
    d_afrr_m = np.array(aFRRminus[:H])

    fig, axes = plt.subplots(3, 1, figsize=(16, 10), sharex=True)
    fig.suptitle("Rezultati optimizacije - Monday + Tuesday", fontsize=14, fontweight="bold")

    # Graf 1: Snage - stacked bar za izvore, linija za potrošnju
    ax1 = axes[0]
    bar_width = 0.8
    # Pozitivna strana: mreža + solar + pražnjenje + manjak
    ax1.bar(hours, d_grid, bar_width, label="Mreža", color="royalblue")
    ax1.bar(hours, d_sol, bar_width, bottom=d_grid, label="Solar", color="gold")
    ax1.bar(hours, d_dis, bar_width, bottom=d_grid + d_sol, label="Pražnjenje bat.", color="red")
    if d_def.max() > 0.001:
        ax1.bar(hours, d_def, bar_width, bottom=d_grid + d_sol + d_dis, label="Manjak", color="magenta")
    # Negativna strana: punjenje baterije + curtailment
    ax1.bar(hours, -d_chg, bar_width, label="Punjenje bat.", color="green")
    ax1.bar(hours, -d_cur, bar_width, bottom=-d_chg, label="Curtailment", color="orange")
    ax1.step(hours, d_cons, where="mid", label="Potrošnja", linewidth=2, color="black", linestyle="--")
    ax1.axvline(x=24, color="gray", linestyle="--", alpha=0.5)
    ax1.set_ylabel("Snaga [MW]")
    ax1.legend(loc="upper right", fontsize=8)
    ax1.grid(True, alpha=0.3)
    ax1.set_title("Energetska bilanca")

    # Graf 2: SOC baterije
    ax2 = axes[1]
    ax2.step(hours, d_soc, where="mid", linewidth=2, color="darkorange")
    ax2.axhline(y=15, color="red", linestyle=":", alpha=0.5, label="SOC min (15%)")
    ax2.axhline(y=90, color="red", linestyle=":", alpha=0.5, label="SOC max (90%)")
    ax2.fill_between(hours, d_soc, alpha=0.2, step="mid", color="orange")
    ax2.axvline(x=24, color="gray", linestyle="--", alpha=0.5)
    ax2.set_ylabel("SOC [%]")
    ax2.set_ylim(0, 100)
    ax2.legend(loc="upper right", fontsize=8)
    ax2.grid(True, alpha=0.3)
    ax2.set_title("Stanje napunjenosti baterije (SOC)")

    # Graf 3: Cijena i aFRR
    ax3 = axes[2]
    ax3.step(hours, d_price, where="mid", linewidth=2, color="darkblue", label="Cijena EE")
    ax3.set_ylabel("Cijena [EUR/MWh]", color="darkblue")
    ax3.tick_params(axis="y", labelcolor="darkblue")
    ax3.grid(True, alpha=0.3)
    ax3.axvline(x=24, color="gray", linestyle="--", alpha=0.5)

    ax3_r = ax3.twinx()
    ax3_r.step(hours, d_afrr_p, where="mid", linewidth=1.5, color="forestgreen", linestyle="-.", label="aFRR+")
    ax3_r.step(hours, d_afrr_m, where="mid", linewidth=1.5, color="crimson", linestyle="-.", label="aFRR-")
    ax3_r.set_ylabel("aFRR [MW]", color="gray")
    ax3_r.tick_params(axis="y", labelcolor="gray")

    lines1, labels1 = ax3.get_legend_handles_labels()
    lines2, labels2 = ax3_r.get_legend_handles_labels()
    ax3.legend(lines1 + lines2, labels1 + labels2, loc="upper right", fontsize=8)
    ax3.set_title("Cijena električne energije i aFRR ponuda")

    ax3.set_xlabel("Sat")
    ax3.set_xticks(range(0, H, 2))
    ax3.set_xlim(-0.5, H - 0.5)

    plt.tight_layout()
    plt.show()

else:
    print("Model nije pronašao izvedivo rješenje!")
