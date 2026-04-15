import json, os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Učitaj CSV (jedna vrijednost po redu, decimalni zarez)
csv_path = os.path.join(BASE, "Ostalo", "Cijene_EE.csv")
prices = []
with open(csv_path, encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if line:
            prices.append(round(float(line.replace(",", ".")), 3))

print(f"Ucitano {len(prices)} cijena  |  min={min(prices):.2f}  max={max(prices):.2f}  avg={sum(prices)/len(prices):.2f}")

# Učitaj input_2.json i zamjeni prices
json_path = os.path.join(BASE, "input_2.json")
with open(json_path, encoding="utf-8") as f:
    data = json.load(f)

assert len(prices) == len(data["prices"]), \
    f"Broj cijena ({len(prices)}) ne odgovara broju slotova ({len(data['prices'])})"

data["prices"] = prices

with open(json_path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print("input_2.json azuriran — cijene zamijenjene.")
