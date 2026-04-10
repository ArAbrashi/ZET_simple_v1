import json
import highspy

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
n_bat_min = params["n_bat_min"]             # h - min broj sati u istom režimu (punjenje/pražnjenje)
price_export = params["price_export"]       # EUR/MWh - cijena prodaje solarne EE u mrežu
eta_chg = params["eta_charge"]              # efikasnost punjenja (0-1)
eta_dis = params["eta_discharge"]           # efikasnost pražnjenja (0-1)
soc_min = params["soc_min"]                 # % - minimalni SOC
soc_max = params["soc_max"]                 # % - maksimalni SOC

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
#   y_chg[t]       - binarna: 1=punjenje aktivno              t = 0..T-1
#   y_dis[t]       - binarna: 1=pražnjenje aktivno           t = 0..T-1
#   p_export[t]    - prodaja solarne EE u mrežu [0, solar]   t = 0..T-1

num_vars = 9 * T
col_lower = []
col_upper = []
col_cost = []

# Indeksi varijabli - grupirani po satu:
#   t=0: [grid_0, charge_0, discharge_0, soc_0], t=1: [grid_1, charge_1, ...], ...
N_VAR_PER_T = 9
def idx_grid(t):      return N_VAR_PER_T * t
def idx_charge(t):    return N_VAR_PER_T * t + 1
def idx_discharge(t): return N_VAR_PER_T * t + 2
def idx_soc(t):       return N_VAR_PER_T * t + 3
def idx_deficit(t):   return N_VAR_PER_T * t + 4
def idx_curtail(t):   return N_VAR_PER_T * t + 5
def idx_ychg(t):      return N_VAR_PER_T * t + 6
def idx_ydis(t):      return N_VAR_PER_T * t + 7
def idx_export(t):    return N_VAR_PER_T * t + 8

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

    # soc[t] u postocima (soc_min-soc_max%)
    col_lower.append(soc_min)
    col_upper.append(soc_max)
    col_cost.append(0.0)

    # p_deficit[t] - manjak EE, s visokim kaznenim troškom
    col_lower.append(0.0)
    col_upper.append(inf)
    col_cost.append(PENALTY_DEFICIT)

    # p_curtail[t] - curtailment solarne elektrane [0, solar_prod[t]]
    col_lower.append(0.0)
    col_upper.append(solar_prod[t])
    col_cost.append(0.0)

    # y_chg[t] - binarna: 1 ako baterija puni u satu t
    col_lower.append(0.0)
    col_upper.append(1.0)
    col_cost.append(0.0)

    # y_dis[t] - binarna: 1 ako baterija prazni u satu t
    col_lower.append(0.0)
    col_upper.append(1.0)
    col_cost.append(0.0)

    # p_export[t] - prodaja solarne EE u mrežu [0, solar_prod[t]]
    # negativan trošak = prihod (smanjuje ukupni trošak)
    col_lower.append(0.0)
    col_upper.append(solar_prod[t])
    col_cost.append(-price_export)

h.addVars(num_vars, col_lower, col_upper)

# Postavi y_chg i y_dis kao binarne (integer) varijable
for t in range(T):
    h.changeColIntegrality(idx_ychg(t), highspy.HighsVarType.kInteger)
    h.changeColIntegrality(idx_ydis(t), highspy.HighsVarType.kInteger)

# Postavi funkciju cilja (minimize)
for i in range(num_vars):
    h.changeColCost(i, col_cost[i])
h.changeObjectiveSense(highspy.ObjSense.kMinimize)

# Ograničenja:

# 1) Energetska ravnoteža:
#    p_grid + eta_dis*p_discharge - p_charge - p_curtail - p_export + p_deficit = consumption - solar_prod
#    (pražnjenje daje eta_dis * p_discharge korisne energije)
for t in range(T):
    rhs = consumption[t] - solar_prod[t]
    indices = [idx_grid(t), idx_discharge(t), idx_charge(t), idx_curtail(t), idx_export(t), idx_deficit(t)]
    values = [1.0, eta_dis, -1.0, -1.0, -1.0, 1.0]
    h.addRow(rhs, rhs, len(indices), indices, values)

# 2) Dinamika SOC-a s efikasnošću:
#    soc[t] = soc[t-1] + eta_chg*p_charge[t]*pct - p_discharge[t]*pct
#    (punjenje: samo eta_chg energije dolazi u bateriju, pražnjenje: uzima punu energiju iz baterije)
#    => soc[t] - eta_chg*pct*p_charge[t] + pct*p_discharge[t] = soc[t-1]
pct_factor = 100.0 / E_bat  # pretvorba MW*1h -> % kapaciteta
for t in range(T):
    soc_prev = SOC_init if t == 0 else None
    if t == 0:
        indices = [idx_soc(t), idx_charge(t), idx_discharge(t)]
        values = [1.0, -eta_chg * pct_factor, pct_factor]
        h.addRow(soc_prev, soc_prev, len(indices), indices, values)
    else:
        indices = [idx_soc(t), idx_soc(t - 1), idx_charge(t), idx_discharge(t)]
        values = [1.0, -1.0, -eta_chg * pct_factor, pct_factor]
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

    # aFRR+ energijska rezerva: SOC mora biti dovoljno visok da isporuči aFRRplus 1 sat
    #   SOC[t] >= SOC_min + aFRRplus[t] * pct_factor
    #   => SOC[t] >= 15 + aFRRplus[t] * (100/E_bat)
    indices = [idx_soc(t)]
    values = [1.0]
    h.addRow(soc_min + aFRRplus[t] * pct_factor, inf, len(indices), indices, values)

    # aFRR- energijska rezerva: SOC mora biti dovoljno nizak da primi aFRRminus 1 sat
    #   SOC[t] <= SOC_max - aFRRminus[t] * pct_factor
    #   => SOC[t] <= 90 - aFRRminus[t] * (100/E_bat)
    indices = [idx_soc(t)]
    values = [1.0]
    h.addRow(-inf, soc_max - aFRRminus[t] * pct_factor, len(indices), indices, values)

# 5a) Ograničenje prodaje: export + curtailment <= solar_prod
#     (ne možemo prodati + curtailati više nego što solar proizvodi)
for t in range(T):
    indices = [idx_export(t), idx_curtail(t)]
    values = [1.0, 1.0]
    h.addRow(-inf, solar_prod[t], len(indices), indices, values)

# 5b) Zabrana istovremenog punjenja i pražnjenja + minimalno trajanje režima:
#    y_chg[t] + y_dis[t] <= 1              (ne može oboje u istom satu)
#    p_charge[t]    <= P_bat * y_chg[t]    (punjenje samo ako y_chg=1)
#    p_discharge[t] <= P_bat * y_dis[t]    (pražnjenje samo ako y_dis=1)
for t in range(T):
    # Međusobna isključivost: y_chg + y_dis <= 1
    indices = [idx_ychg(t), idx_ydis(t)]
    values = [1.0, 1.0]
    h.addRow(-inf, 1.0, len(indices), indices, values)

    # Punjenje samo ako y_chg=1: p_charge - P_bat*y_chg <= 0
    indices = [idx_charge(t), idx_ychg(t)]
    values = [1.0, -P_bat]
    h.addRow(-inf, 0.0, len(indices), indices, values)

    # Pražnjenje samo ako y_dis=1: p_discharge - P_bat*y_dis <= 0
    indices = [idx_discharge(t), idx_ydis(t)]
    values = [1.0, -P_bat]
    h.addRow(-inf, 0.0, len(indices), indices, values)

# 6) Minimalno trajanje režima (n_bat_min sati):
#    Ako se puni u satu t, ne smije se prazniti u sljedećih n_bat_min-1 sati, i obrnuto.
#    Mirovanje (y_chg=0 i y_dis=0) ne smeta.
for t in range(T):
    for k in range(t + 1, min(t + n_bat_min, T)):
        # Ako puni u t, ne prazni u k: y_chg[t] + y_dis[k] <= 1
        indices = [idx_ychg(t), idx_ydis(k)]
        values = [1.0, 1.0]
        h.addRow(-inf, 1.0, len(indices), indices, values)

        # Ako prazni u t, ne puni u k: y_dis[t] + y_chg[k] <= 1
        indices = [idx_ydis(t), idx_ychg(k)]
        values = [1.0, 1.0]
        h.addRow(-inf, 1.0, len(indices), indices, values)

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
    E_export_total = sum(max(0.0, sol[idx_export(t)]) for t in range(T))
    R_export_total = E_export_total * price_export

    print(f"Ukupno preuzeto iz mreže: {E_grid_total:,.2f} MWh")
    print(f"Ukupna potrošnja:         {sum(consumption):,.2f} MWh")
    print(f"Solarna proizvodnja:      {E_solar_total:,.2f} MWh")
    print(f"Prodano u mrežu:          {E_export_total:,.2f} MWh  ({R_export_total:,.2f} EUR)")
    print(f"Curtailment solara:       {E_curtail_total:,.2f} MWh")
    print(f"Ukupni manjak EE:         {E_deficit_total:,.2f} MWh")
    # Trošak bez penala za manjak
    cost_no_penalty = obj - E_deficit_total * PENALTY_DEFICIT
    cost_no_bat = sum(p * max(c - s, 0) for p, c, s in zip(prices, consumption, solar_prod))
    print(f"Optimalni tjedni trošak:  {cost_no_penalty:,.2f} EUR (bez penala za manjak)")
    print(f"Trošak bez baterije:      {cost_no_bat:,.2f} EUR (bez penala za manjak)")
    print(f"Ušteda:                   {cost_no_bat - cost_no_penalty:,.2f} EUR")
    if E_deficit_total > 0.001:
        print(f"  *** PAŽNJA: konzum nije u potpunosti namiren ({E_deficit_total:,.2f} MWh manjka) ***")
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
        print(f"{'Sat':>4} | {'Cijena':>8} | {'Potraž.':>7} | {'Solar':>5} | {'Mreža':>6} | {'Punj.':>6} | {'Praž.':>6} | {'Export':>6} | {'Curt.':>5} | {'Manj.':>6} | {'aFRR+':>5} | {'aFRR-':>5} | {'SOC %':>6}")
        print("-" * 120)
        for t in range(start, end):
            v_grid = max(0.0, sol[idx_grid(t)])
            v_chg  = max(0.0, sol[idx_charge(t)])
            v_dis  = max(0.0, sol[idx_discharge(t)])
            v_def  = max(0.0, sol[idx_deficit(t)])
            v_cur  = max(0.0, sol[idx_curtail(t)])
            v_exp  = max(0.0, sol[idx_export(t)])
            v_soc  = sol[idx_soc(t)]
            print(f"{t - start:4d} | {prices[t]:7.1f}  | {consumption[t]:6.1f}  | {solar_prod[t]:4.2f}  | {v_grid:5.2f}  | "
                  f"{v_chg:5.2f}  | {v_dis:5.2f}  | {v_exp:5.2f}  | {v_cur:4.2f}  | {v_def:5.2f}  | {aFRRplus[t]:4.1f}  | {aFRRminus[t]:4.1f}  | {v_soc:5.1f}%")
    '''
    
    # Dijagram za 3 dana (72 sata)
    H = 72
    hours = list(range(H))

    d_grid = np.array([max(0.0, sol[idx_grid(t)]) for t in range(H)])
    d_chg  = np.array([max(0.0, sol[idx_charge(t)]) for t in range(H)])
    d_dis  = np.array([max(0.0, sol[idx_discharge(t)]) for t in range(H)])
    d_def  = np.array([max(0.0, sol[idx_deficit(t)]) for t in range(H)])
    d_cur  = np.array([max(0.0, sol[idx_curtail(t)]) for t in range(H)])
    d_exp  = np.array([max(0.0, sol[idx_export(t)]) for t in range(H)])
    d_sol  = np.array(solar_prod[:H])
    d_soc  = np.array([sol[idx_soc(t)] for t in range(H)])
    d_price = np.array(prices[:H])
    d_cons = np.array(consumption[:H])
    d_afrr_p = np.array(aFRRplus[:H])
    d_afrr_m = np.array(aFRRminus[:H])

    fig, axes = plt.subplots(3, 1, figsize=(22, 12), sharex=True)
    fig.suptitle("Rezultati optimizacije - Monday + Tuesday + Wednesday", fontsize=14, fontweight="bold")

    # Tekstualni ispis troškova na dijagramu
    info_text = (f"Optimalni tjedni trošak: {cost_no_penalty:,.2f} EUR\n"
                 f"Trošak bez baterije:     {cost_no_bat:,.2f} EUR\n"
                 f"Ušteda:                  {cost_no_bat - cost_no_penalty:,.2f} EUR")
    if E_deficit_total > 0.001:
        info_text += f"\n*** PAŽNJA: konzum nije u potpunosti namiren ({E_deficit_total:,.2f} MWh manjka) ***"
    fig.text(0.99, 0.01, info_text, fontsize=10, fontfamily="monospace",
             horizontalalignment="right", verticalalignment="bottom", multialignment="left",
             bbox=dict(boxstyle="round,pad=0.5", facecolor="lightyellow", alpha=0.8))

    # Graf 1: Snage - stacked bar za izvore, linija za potrošnju
    ax1 = axes[0]
    bar_width = 0.8
    # Pozitivna strana: mreža + solar + pražnjenje + manjak
    ax1.bar(hours, d_grid, bar_width, label="Mreža", color="royalblue")
    ax1.bar(hours, d_sol, bar_width, bottom=d_grid, label="Solar", color="gold")
    ax1.bar(hours, d_dis, bar_width, bottom=d_grid + d_sol, label="Pražnjenje bat.", color="red")
    if d_def.max() > 0.001:
        ax1.bar(hours, d_def, bar_width, bottom=d_grid + d_sol + d_dis, label="Manjak", color="magenta")
    # Negativna strana: punjenje baterije + export + curtailment
    ax1.bar(hours, -d_chg, bar_width, label="Punjenje bat.", color="green")
    ax1.bar(hours, -d_exp, bar_width, bottom=-d_chg, label="Export", color="cyan")
    ax1.bar(hours, -d_cur, bar_width, bottom=-d_chg - d_exp, label="Curtailment", color="orange")
    ax1.step(hours, d_cons, where="mid", label="Potrošnja", linewidth=2, color="black", linestyle="--")
    ax1.axvline(x=24, color="gray", linestyle="--", alpha=0.5)
    ax1.axvline(x=48, color="gray", linestyle="--", alpha=0.5)
    ax1.set_ylabel("Snaga [MW]")
    ax1.legend(loc="upper right", fontsize=8)
    ax1.grid(True, alpha=0.3)
    ax1.set_title("Energetska bilanca")

    # Graf 2: SOC baterije + efektivne granice (sve u %)
    ax2 = axes[1]
    # Efektivne SOC granice s aFRR rezervom (u %)
    soc_lower = 15.0 + d_afrr_p * pct_factor   # SOC_min + aFRR+ rezerva
    soc_upper = 90.0 - d_afrr_m * pct_factor   # SOC_max - aFRR- rezerva
    ax2.step(hours, d_soc, where="mid", linewidth=2, color="darkorange", label="SOC")
    ax2.step(hours, soc_lower, where="mid", linewidth=1.5, color="crimson", linestyle="-.", label=f"SOC min + aFRR+")
    ax2.step(hours, soc_upper, where="mid", linewidth=1.5, color="forestgreen", linestyle="-.", label=f"SOC max - aFRR-")
    ax2.axhline(y=15, color="red", linestyle=":", alpha=0.3, label="SOC min (15%)")
    ax2.axhline(y=90, color="red", linestyle=":", alpha=0.3, label="SOC max (90%)")
    ax2.fill_between(hours, d_soc, alpha=0.2, step="mid", color="orange")
    ax2.axvline(x=24, color="gray", linestyle="--", alpha=0.5)
    ax2.axvline(x=48, color="gray", linestyle="--", alpha=0.5)
    ax2.set_ylabel("SOC [%]")
    ax2.set_ylim(0, 100)
    ax2.legend(loc="upper right", fontsize=8)
    ax2.grid(True, alpha=0.3)
    ax2.set_title("Stanje napunjenosti baterije (SOC) i aFRR granice")

    # Graf 3: Cijena
    ax3 = axes[2]
    ax3.step(hours, d_price, where="mid", linewidth=2, color="darkblue", label="Cijena EE")
    ax3.set_ylabel("Cijena [EUR/MWh]", color="darkblue")
    ax3.tick_params(axis="y", labelcolor="darkblue")
    ax3.grid(True, alpha=0.3)
    ax3.axvline(x=24, color="gray", linestyle="--", alpha=0.5)
    ax3.axvline(x=48, color="gray", linestyle="--", alpha=0.5)
    ax3.legend(loc="upper right", fontsize=8)
    ax3.set_title("Cijena električne energije")

    ax3.set_xlabel("Sat")
    ax3.set_xticks(range(0, H, 3))
    ax3.set_xlim(-0.5, H - 0.5)

    plt.tight_layout()
    plt.show()
    '''
    # Export rezultata u JSON za dashboard
    results = {
        "summary": {
            "cost_optimized": round(cost_no_penalty, 2),
            "cost_no_battery": round(cost_no_bat, 2),
            "savings": round(cost_no_bat - cost_no_penalty, 2),
            "E_grid_total": round(E_grid_total, 2),
            "E_consumption_total": round(sum(consumption), 2),
            "E_solar_total": round(E_solar_total, 2),
            "E_export_total": round(E_export_total, 2),
            "R_export_total": round(R_export_total, 2),
            "E_curtail_total": round(E_curtail_total, 2),
            "E_deficit_total": round(E_deficit_total, 2),
        },
        "parameters": params,
        "days": data["days"],
        "hourly": []
    }
    for t in range(T):
        results["hourly"].append({
            "t": t,
            "day": t // 24,
            "hour": t % 24,
            "price": prices[t],
            "consumption": consumption[t],
            "solar": round(solar_prod[t], 4),
            "grid": round(max(0.0, sol[idx_grid(t)]), 4),
            "charge": round(max(0.0, sol[idx_charge(t)]), 4),
            "discharge": round(max(0.0, sol[idx_discharge(t)]), 4),
            "export": round(max(0.0, sol[idx_export(t)]), 4),
            "curtail": round(max(0.0, sol[idx_curtail(t)]), 4),
            "deficit": round(max(0.0, sol[idx_deficit(t)]), 4),
            "soc": round(sol[idx_soc(t)], 2),
            "aFRRplus": aFRRplus[t],
            "aFRRminus": aFRRminus[t],
        })
    with open("results.json", "w") as f:
        json.dump(results, f, indent=2)
    print("\nRezultati spremljeni u results.json")

else:
    print("Model nije pronašao izvedivo rješenje!")
