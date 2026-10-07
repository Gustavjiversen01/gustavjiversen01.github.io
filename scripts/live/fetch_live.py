"""Live market caps for the AI supply-chain explorer (runs every 10 minutes in GitHub Actions).

Usage: python fetch_live.py SYMBOLS_JSON PREV_LIVE_JSON OUT_JSON

SYMBOLS_JSON is public/ai-supply-chain/live_symbols.json, written by the explorer's export: per Yahoo
symbol, the node ids, the quote currency and k, where market cap (local, bn) = k x price.
Prices come from Yahoo's public spark endpoint (no key). Standard library only.
A symbol that fails keeps its previous value, and the job never writes an empty file.
"""
import json, sys, time, urllib.request

SPARK = "https://query1.finance.yahoo.com/v7/finance/spark?symbols={}&range=1d&interval=15m"
HIST_MAX = 600  # about four trading days of 10-minute points


def spark(symbols):
    out = {}
    for i in range(0, len(symbols), 20):
        batch = symbols[i:i + 20]
        for attempt in range(3):
            try:
                req = urllib.request.Request(SPARK.format(",".join(batch)), headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=20) as r:
                    d = json.load(r)
                for res in d.get("spark", {}).get("result") or []:
                    resp = (res.get("response") or [None])[0]
                    m = (resp or {}).get("meta") or {}
                    p, pc = m.get("regularMarketPrice"), m.get("chartPreviousClose")
                    if p and pc:
                        out[res["symbol"]] = (float(p), float(pc), int(m.get("regularMarketTime") or 0))
                break
            except Exception as e:  # noqa: BLE001
                print("spark error", batch[0], e, file=sys.stderr)
                time.sleep(2 * (attempt + 1))
        time.sleep(0.3)
    return out


def main():
    syms_path, prev_path, out_path = sys.argv[1:4]
    S = json.load(open(syms_path))["symbols"]
    try:
        prev = json.load(open(prev_path))
    except Exception:  # noqa: BLE001
        prev = {}
    ccys = sorted({v["ccy"] for v in S.values()} - {"USD"})
    fxq = spark([f"{c}=X" for c in ccys])  # USD -> ccy; inverted below (KRWUSD=X is rounded to 4 dp)
    fx = {"USD": 1.0}
    for c in ccys:
        q = fxq.get(f"{c}=X")
        if q:
            fx[c] = 1.0 / q[0]
        elif c in (prev.get("fx") or {}):
            fx[c] = prev["fx"][c]
    quotes = spark(sorted(S))
    now = int(time.time())
    q_out, tot_now, tot_prev = {}, 0.0, 0.0
    for s, meta in S.items():
        r = fx.get(meta["ccy"])
        if s in quotes and r:
            p, pc, ts = quotes[s]
            m = meta["k"] * p * r
            q_out[s] = {"i": meta["ids"], "p": round(p, 4), "pc": round(pc, 4), "c": round((p / pc - 1) * 100, 2), "m": round(m, 3), "ts": ts}
        elif s in (prev.get("q") or {}):
            q_out[s] = dict(prev["q"][s], stale=1)
        else:
            continue
        x = q_out[s]
        tot_now += x["m"]
        tot_prev += x["m"] / (1 + x["c"] / 100)
    markets = json.load(open(syms_path)).get("markets") or {}
    mq = spark(sorted({m["sym"] for m in markets.values()}))
    mk = {}
    for key, m in markets.items():
        if m["sym"] in mq:
            p, pc, ts = mq[m["sym"]]
            mk[key] = {"label": m["label"], "unit": m["unit"], "kind": m["kind"], "layers": m["layers"], "v": round(p, 4), "pc": round(pc, 4), "c": round((p / pc - 1) * 100, 2), "ts": ts}
        elif key in (prev.get("mk") or {}):
            mk[key] = dict(prev["mk"][key], stale=1)
    fresh = sum(1 for s in q_out if not q_out[s].get("stale"))
    if fresh < len(S) * 0.5:
        print(f"only {fresh}/{len(S)} quotes; keeping the previous file")
        return
    hist = [h for h in (prev.get("h") or []) if h[0] < now - 60][-HIST_MAX + 1:] + [[now, round(tot_now, 1)]]
    out = {
        "t": now,
        "n": fresh,
        "fx": {k: round(v, 8) for k, v in fx.items()},
        "idx": {"m": round(tot_now, 1), "c": round((tot_now / tot_prev - 1) * 100, 2) if tot_prev else 0},
        "q": q_out,
        "mk": mk,
        "mh": {k: ([x for x in (prev.get("mh") or {}).get(k, []) if x[0] < now - 60][-HIST_MAX + 1:] + [[now, v["v"]]]) for k, v in mk.items() if not v.get("stale")},
        "h": hist,
    }
    with open(out_path, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"{fresh}/{len(S)} quotes, chain ${tot_now/1000:.2f}tn, {out['idx']['c']:+.2f}% today")


if __name__ == "__main__":
    main()
