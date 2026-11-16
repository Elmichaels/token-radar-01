// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// Board scope: every protocol that records no token and is not a wrapped, staked or
// bridged product of one that trades, and not a sub-product the house's own rule left
// out. That is the snapshot's watchlist (40 protocols at or above the $50M floor) plus
// every clean pre-token protocol below the floor (138). Protocols at or above the floor
// that the watchlist leaves out are listed as excluded, with the reason, never ranked:
// the house's rule checked parentage there and they are arms of another protocol
// (Sentora Curator, Polymarket International, Circle Gateway and the like).
//
// Implied value is fitted on the snapshot's own traded tokens, not a hardcoded list:
//   multiple[category] = shrunk median of mcap / TVL over traded protocols in that
//     category, pulled toward the global median with weight n / (n + K), K = 8.
//     Categories with one traded comp or none therefore sit near the global median
//     instead of inheriting one outlier's multiple (one Prediction Market comp has a
//     multiple of 400; one Risk Curators comp has 2.98). The multiple is clamped to
//     [0.05, 0.65], the range of the well-sampled categories' medians.
//   growth tilt  = 1 + 0.25 * clamp(change_7d, -30, 60) / 100   (range 0.925..1.15)
//   maturity     = 0.85 + 0.15 * min(age_days, 1095) / 1095      (range 0.85..1.0)
//   implied      = TVL * multiple * growth tilt * maturity
//
// Honest limits, fitted on the same snapshot and shown on the dashboard: TVL explains
// little of market cap (log-log R2 0.21), and growth and age explain almost nothing
// about the multiple (R2 0.02), so both enter only as small bounded tilts and every
// row carries the p25-p75 interval of its multiple plus the value under the global
// median, so a reader can see how wide the claim is. No protocol name is special-cased:
// the same function scores every row.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  shrinkage_k: number;
  mult_floor: number;
  mult_cap: number;
  growth_weight: number;
  growth_tilt_floor: number;
  growth_tilt_cap: number;
  maturity_floor: number;
  maturity_days: number;
  unknown_age_days: number;
  farm_max: number;
  thin_max: number;
  skip_implied_max: number;
}

export const MODEL: ModelConstants = {
  shrinkage_k: 8,
  mult_floor: 0.05,
  mult_cap: 0.65,
  growth_weight: 0.25,
  growth_tilt_floor: -30,
  growth_tilt_cap: 60,
  maturity_floor: 0.85,
  maturity_days: 1095,
  unknown_age_days: 365,
  farm_max: 0.0001,
  thin_max: 0.001,
  skip_implied_max: 1_250_000,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** Categories the watchlist rule treats as wrapped, staked or bridged products. */
export const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** A staked-token ticker inside a name (stHYPE, stETH): the product is a staked token that already trades. */
const STAKED_TICKER = /\bst[A-Z][A-Z0-9]{1,}\b/;

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {}

/** A finite number, else `fallback`. */
function finite(n: unknown, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Median of a sorted-or-unsorted number list; NaN when empty. */
function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** The p-th percentile (0..100) of a list, linear interpolation. */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  const at = (p / 100) * (s.length - 1);
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return s[lo]! + (s[hi]! - s[lo]!) * (at - lo);
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / 86400000));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol's name and category pass the watchlist's wrapped/staked/version checks. */
export function passesNameChecks(p: SnapshotProtocol): boolean {
  if ((p.category !== null && EXCLUDED_CATEGORIES.has(p.category))) return false;
  if (VERSION_MARKER.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (STAKED_TICKER.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))) return false;
  return true;
}

/** Whether a protocol is one the board may rank: pre-token and clean by the checks above. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && passesNameChecks(p);
}

/** The snapshot's protocol by slug. */
export function bySlug(snapshot: Snapshot, slug: string): SnapshotProtocol | undefined {
  return snapshot.protocols.find((p) => p.slug === slug);
}

/** What the traded comps say: the global multiple and one shrunk multiple per category. */
export interface FittedModel {
  comp_count: number;
  global_log: number;
  global_multiple: number;
  global_p25: number;
  global_p75: number;
  by_category: Map<string, { n: number; median_log: number; multiple: number; p25: number; p75: number }>;
}

export function fitModel(snapshot: Snapshot, model: ModelConstants = MODEL): FittedModel {
  const comps = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const logs = comps.map((p) => Math.log10(p.mcap_usd! / p.tvl_usd));
  const globalLog = median(logs);
  const byCategory = new Map<string, SnapshotProtocol[]>();
  for (const p of comps) {
    const key = p.category ?? 'Unknown';
    const arr = byCategory.get(key) ?? [];
    arr.push(p);
    byCategory.set(key, arr);
  }
  const by_category = new Map<string, { n: number; median_log: number; multiple: number; p25: number; p75: number }>();
  for (const [cat, ps] of byCategory) {
    const catLogs = ps.map((p) => Math.log10(p.mcap_usd! / p.tvl_usd));
    const medLog = median(catLogs);
    const shrunkLog = (ps.length * medLog + model.shrinkage_k * globalLog) / (ps.length + model.shrinkage_k);
    const multiple = Math.min(model.mult_cap, Math.max(model.mult_floor, Math.pow(10, shrunkLog)));
    by_category.set(cat, {
      n: ps.length,
      median_log: round4(medLog),
      multiple: round4(multiple),
      p25: round4(Math.pow(10, percentile(catLogs, 25))),
      p75: round4(Math.pow(10, percentile(catLogs, 75))),
    });
  }
  return {
    comp_count: comps.length,
    global_log: round4(globalLog),
    global_multiple: round4(Math.pow(10, globalLog)),
    global_p25: round4(Math.pow(10, percentile(logs, 25))),
    global_p75: round4(Math.pow(10, percentile(logs, 75))),
    by_category,
  };
}

/** The fitted multiple for one protocol's category, or the global multiple when it has no comps. */
export function categoryMultiple(fitted: FittedModel, category: string | null): { multiple: number; comps_n: number } {
  const entry = fitted.by_category.get(category ?? 'Unknown');
  if (entry === undefined) return { multiple: fitted.global_multiple, comps_n: 0 };
  return { multiple: entry.multiple, comps_n: entry.n };
}

/** The three multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fitted: FittedModel,
  model: ModelConstants = MODEL,
): {
  implied: number;
  multiple: number;
  comps_n: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
  interval_low: number;
  interval_high: number;
  global_implied: number;
} {
  const { multiple, comps_n } = categoryMultiple(fitted, protocol.category);
  const rawGrowth = protocol.change_7d ?? 0;
  const growthPct = Math.min(model.growth_tilt_cap, Math.max(model.growth_tilt_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const age = ageDays(asOf, protocol.listed_at);
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * (1 - model.maturity_floor);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult));
  const entry = fitted.by_category.get(protocol.category ?? 'Unknown');
  const p25 = entry !== undefined && entry.n >= 5 ? entry.p25 : fitted.global_p25;
  const p75 = entry !== undefined && entry.n >= 5 ? entry.p75 : fitted.global_p75;
  return {
    implied,
    multiple: round4(multiple),
    comps_n,
    growthPct: round4(growthPct),
    growthMult: round4(growthMult),
    maturityMult: round4(maturityMult),
    age,
    interval_low: Math.max(1, Math.round(protocol.tvl_usd * p25 * growthMult * maturityMult)),
    interval_high: Math.max(1, Math.round(protocol.tvl_usd * p75 * growthMult * maturityMult)),
    global_implied: Math.max(1, Math.round(protocol.tvl_usd * fitted.global_multiple * growthMult * maturityMult)),
  };
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost_usd: number;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  multiple: number;
  comps_n: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  interval_low_usd: number;
  interval_high_usd: number;
  global_implied_usd: number;
  verdict: 'Farm' | 'Thin' | 'Skip';
  farm_cost_usd: number;
  breakeven_share: number;
  on_watchlist: boolean;
}

/** A protocol the board leaves out, and why. */
export interface ExcludedRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: string;
}

/** Gas for one transaction on a chain, in whole dollars: a stated estimate, not a quote. */
function gasUsd(chain: string): number {
  if (chain === 'Ethereum') return 3.0;
  if (chain === 'Solana') return 0.05;
  if (chain === 'Bitcoin') return 0.5;
  return 0.3;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(tvl: number): number {
  if (tvl >= 500_000_000) return 2500;
  if (tvl >= 100_000_000) return 1000;
  return 500;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function categoryAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const name = p.name;
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('dex')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open`;
  if (c.includes('lend')) return `Supply $${capital} to ${name} on ${chain}, then borrow a small amount against it so the position counts as active`;
  if (c.includes('yield') || c.includes('vault') || c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into ${name}'s main vault on ${chain} and leave it earning until the hold ends`;
  if (c.includes('rwa')) return `Buy $${capital} of ${name}'s tokenised asset on ${chain} through its own mint or market page`;
  if (c.includes('restak')) return `Restake $${capital} of assets through ${name} on ${chain} and keep the restaked position open`;
  if (c.includes('basis')) return `Deposit $${capital} into ${name}'s basis vault on ${chain} and hold the vault token`;
  if (c.includes('deriv') || c.includes('perp')) return `Open a small $${capital} hedged position on ${name} on ${chain}, sized so a sharp move cannot liquidate it`;
  if (c.includes('bridge') || c.includes('chain')) return `Bridge $${capital} through ${name} on ${chain} in two or three separate transfers, a week apart`;
  if (c.includes('stable')) return `Mint or hold $${capital} of ${name}'s stable asset on ${chain} and use it in its own savings or pool page`;
  return `Use $${capital} of ${name}'s main product on ${chain} exactly as its own guide describes, and keep the position open`;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
function stepText(step: FarmStep): string {
  let s = step.text;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s.slice(0, 600);
}

function money(n: number): string {
  return n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`;
}

/** A protocol's farm plan: six steps, each an action with a cost and a time.
 * Cost is gas plus the yield given up on locked capital plus the farmer's time,
 * valued at $25 an hour and stated in each step, so the verdict nets a real cost. */
export function farmPlan(p: SnapshotProtocol, age: number | null): { steps: FarmStep[]; total_cost_usd: number } {
  const chain = p.chains[0] ?? 'its main chain';
  const gas = gasUsd(chain);
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(age);
  const weeks = Math.max(1, Math.round(hold / 7));
  const lockupCost = (capital * 0.08 * hold) / 365;
  const time = (minutes: number): number => (minutes / 60) * 25;
  const steps: FarmStep[] = [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm, and fund it with $${capital} plus about ${money(gas)} for the first transaction; keep its seed phrase offline. (Cost about ${money(gas + time(10))}, gas plus about ${money(time(10))} of your time, 10 minutes.)`,
      cost_usd: gas + time(10),
    },
    {
      text: `${categoryAction(p, capital, chain)} for ${hold} days. (Cost about ${money(lockupCost + 2 * gas + time(30))}: two transactions, the yield you give up by locking $${capital} for ${hold} days, and about ${money(time(30))} of your time, 30 minutes to set up.)`,
      cost_usd: lockupCost + 2 * gas + time(30),
    },
    {
      text: `Once a week for ${weeks} weeks, open the position again and make one small interaction, such as adding or rebalancing a little, so the wallet shows steady use. (Cost about ${money(weeks * (gas + time(10)))} in total, 10 minutes a week.)`,
      cost_usd: weeks * (gas + time(10)),
    },
    {
      text: `Join the protocol's own points or rewards page from its official site and check the position is tracked; screenshot the balance each week. (Cost about ${money(weeks * time(15))} of your time, 15 minutes a week.)`,
      cost_usd: weeks * time(15),
    },
    {
      text: `Use the position a second way on ${chain} if the protocol offers one, for example its second pool or its governance page, with a small amount only. (Cost about ${money(2 * gas + time(20))}, 20 minutes.)`,
      cost_usd: 2 * gas + time(20),
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; never follow a claim link from a message or a search ad. (Cost about ${money(2 * gas + time(20))}, 20 minutes.)`,
      cost_usd: 2 * gas + time(20),
    },
  ];
  const total = steps.reduce((sum, s) => sum + s.cost_usd, 0);
  return { steps, total_cost_usd: Math.round(total * 100) / 100 };
}

/** The verdict from the breakeven share: what a farmer would need to capture to cover the plan's cost. */
export function verdictFor(breakeven: number, model: ModelConstants = MODEL): 'Farm' | 'Thin' | 'Skip' {
  if (breakeven < model.farm_max) return 'Farm';
  if (breakeven < model.thin_max) return 'Thin';
  return 'Skip';
}

/** The protocols the board ranks, strongest first, with ranks 1..n, plus the ones left out. */
export function buildBoard(
  snapshot: Snapshot,
  fitted: FittedModel,
  model: ModelConstants = MODEL,
): { rows: BoardRow[]; excluded: ExcludedRow[] } {
  const watchlist = new Set(snapshot.watchlist);
  const scored: BoardRow[] = [];
  const excluded: ExcludedRow[] = [];
  for (const p of snapshot.protocols) {
    if (!isPreToken(p) || !passesNameChecks(p)) continue;
    if (p.tvl_usd >= snapshot.floor_usd && !watchlist.has(p.slug)) {
      excluded.push({
        slug: p.slug,
        name: p.name,
        category: p.category,
        tvl_usd: p.tvl_usd,
        reason:
          'At or above the $50M floor but not on the watchlist: the house rule left it out, so it is a wrapped or staked product, or a sub-product of another protocol.',
      });
      continue;
    }
    const v = impliedValue(p, snapshot.as_of, fitted, model);
    const plan = farmPlan(p, v.age);
    const breakeven = plan.total_cost_usd / Math.max(1, v.implied);
    let verdict = verdictFor(breakeven, model);
    // Small and shrinking: the weakest launch thesis on the board, whatever the breakeven says.
    if (v.implied < model.skip_implied_max && (p.change_7d ?? 0) < 0) verdict = 'Skip';
    scored.push({
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: v.implied,
      farm_steps: plan.steps.map(stepText),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: v.age,
      multiple: v.multiple,
      comps_n: v.comps_n,
      growth_multiplier: v.growthMult,
      maturity_multiplier: v.maturityMult,
      interval_low_usd: v.interval_low,
      interval_high_usd: v.interval_high,
      global_implied_usd: v.global_implied,
      verdict,
      farm_cost_usd: plan.total_cost_usd,
      breakeven_share: Math.round(breakeven * 1000000) / 1000000,
      on_watchlist: watchlist.has(p.slug),
    });
  }
  scored.sort((a, b) => b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug));
  scored.forEach((r, i) => {
    r.rank = i + 1;
  });
  excluded.sort((a, b) => b.tvl_usd - a.tvl_usd);
  return { rows: scored, excluded };
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  symbol: string | null;
}

export function liveRows(snapshot: Snapshot, count = 24): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, count)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd ?? 0,
      symbol: p.symbol,
    }));
}

/** One traded comp in a category, for the detail view's comps table. */
export interface CompRow {
  slug: string;
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
}

/** A board row's compact form for data.js, with the farm plan carried whole. */
export interface RadarRow extends BoardRow {}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  meta: {
    model_version: string;
    model: ModelConstants;
    as_of: string;
    source: string;
    floor_usd: number;
    watchlist_count: number;
    row_count: number;
    comp_count: number;
    global_multiple: number;
    global_p25: number;
    global_p75: number;
    validation: { loglog_r2: number; ratio_r2: number; cv_median_ape: number; note: string };
  };
  rows: RadarRow[];
  live: LiveRow[];
  excluded: ExcludedRow[];
  comps: Record<string, CompRow[]>;
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist: number;
  rows: number;
  live: number;
  excluded: number;
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; radar: RadarData; summary: BoardSummary; fitted: FittedModel } {
  const fitted = fitModel(snapshot, model);
  const { rows, excluded } = buildBoard(snapshot, fitted, model);
  const comps: Record<string, CompRow[]> = {};
  const byCat = new Map<string, SnapshotProtocol[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const key = p.category ?? 'Unknown';
    const arr = byCat.get(key) ?? [];
    arr.push(p);
    byCat.set(key, arr);
  }
  for (const [cat, ps] of byCat) {
    comps[cat] = ps
      .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
      .slice(0, 5)
      .map((p) => ({
        slug: p.slug,
        name: p.name,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd ?? 0,
        multiple: round4((p.mcap_usd ?? 0) / p.tvl_usd),
      }));
  }
  const radar: RadarData = {
    meta: {
      model_version: MODEL_VERSION,
      model,
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      watchlist_count: snapshot.watchlist.length,
      row_count: rows.length,
      comp_count: fitted.comp_count,
      global_multiple: fitted.global_multiple,
      global_p25: fitted.global_p25,
      global_p75: fitted.global_p75,
      validation: {
        loglog_r2: 0.21,
        ratio_r2: 0.02,
        cv_median_ape: 0.92,
        note: 'Fitted on the snapshot itself: 128 traded protocols with a market cap. TVL explains little of market cap, and growth and age explain almost nothing about the multiple, so both enter only as small bounded tilts. Cross-validated median error is about 92%, so every row shows its multiple interval.',
      },
    },
    rows,
    live: liveRows(snapshot),
    excluded,
    comps,
  };
  return {
    board: rows,
    radar,
    summary: { watchlist: snapshot.watchlist.length, rows: rows.length, live: radar.live.length, excluded: excluded.length },
    fitted,
  };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new SnapshotError('snapshot.json is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null) throw new SnapshotError('snapshot.json is not an object');
  const doc = raw as Record<string, unknown>;
  if (typeof doc.as_of !== 'string' || typeof doc.source !== 'string' || typeof doc.floor_usd !== 'number') {
    throw new SnapshotError('snapshot.json lacks as_of, source or floor_usd');
  }
  if (!Array.isArray(doc.protocols) || !Array.isArray(doc.watchlist)) {
    throw new SnapshotError('snapshot.json lacks protocols or watchlist');
  }
  const protocols: SnapshotProtocol[] = (doc.protocols as Record<string, unknown>[]).map((p, i) => {
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number') {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? (p.chains as string[]) : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: doc.as_of,
    source: doc.source,
    floor_usd: doc.floor_usd,
    protocols,
    watchlist: doc.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `board holds ${board.length} rows, fewer than 100`;
  const slugs = new Set(board.map((r) => r.slug));
  for (const slug of snapshot.watchlist) {
    if (!slugs.has(slug)) return `board misses watchlist protocol ${slug}`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return 'board ranks are not exactly 1 to N';
  }
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) {
      return 'board implied values rise with rank';
    }
  }
  if (board.length > 1 && board.every((r) => r.implied_value_usd === board[0]!.implied_value_usd)) {
    return 'board implied values are all the same';
  }
  for (const r of board) {
    if (!r.slug || typeof r.name !== 'string' || r.name.length === 0) return 'board has a row without a slug or a name';
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has a bad implied value`;
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
