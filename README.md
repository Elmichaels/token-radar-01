# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Elmichaels/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Elmichaels/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: a fitted comps model ranks 177 pre-token protocols by implied value (TVL × shrunk category multiple), with costed farm plans, uncertainty intervals, and a dashboard to explore the board. All 40 watchlist protocols are covered; every row carries its verdict (Farm / Thin / Skip), its p25–p75 value interval, and the traded comps behind its multiple.

## Run it

```sh
node main.ts --input /input/snapshot.json --output /output
```

The program reads a DefiLlama snapshot (`/input/snapshot.json`), writes `board.json`, `data.js` and `dossier.json` to the output directory, and copies the dashboard and screenshots alongside. It runs on Node 22 with the standard library only, deterministically, no network.

## How it works

- **Model (radar-2).** Implied value = TVL × category multiple × growth tilt × maturity. The category multiple is the median log10(mcap/TVL) of traded comps in the category, shrunk toward the global median (0.214) with weight n/(n+8), clamped to [0.05, 0.65]. Growth tilt is capped at 0.925–1.15 from the 7-day TVL change; maturity is 0.85–1.0 by protocol age.
- **Honest validation.** The dashboard shows the fit as it is: log-log R² 0.21, 5-fold CV median error ~92%. The model is a ranking aid with wide intervals, not a price forecast.
- **Farm plans.** Each row gets a 6-step plan costed as gas (by chain tier) + capital lockup at 8% APR + time at $25/hr. Verdict from breakeven share = cost / implied value: Farm below 0.01%, Thin below 0.1%, Skip above — plus a Skip overlay for tiny implied values with negative 7-day momentum.
- **Dashboard.** `dashboard/` is a static app: sortable/filterable board, per-protocol detail with model breakdown and named traded comps, a live view of traded tokens (never ranked), a model sandbox to re-price rows under different assumptions, and the 20 above-floor names left out, listed with reasons.

---

<sub>Entered on [make.fun](https://make.fun/?ref=yq54s109&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
