// Counting methods. Input is the /api/results payload:
//   { pizzas: [{ id, category, ... }], voters: [{ id, name }], scores: [{ v, p, pos, s }] }
// A voter's ranking is implied by their scores; equal scores are ties.

export const METHODS = [
  { key: "average", label: "Average score", blurb: "Mean of everyone's scores." },
  { key: "firsts", label: "Most firsts", blurb: "Whose pizza was each person's favourite. Ties split the point." },
  { key: "irv", label: "Instant runoff", blurb: "Last place is knocked out each round and those votes move to each person's next favourite." },
  { key: "stv", label: "STV podium", blurb: "Single transferable vote electing 3. Votes beyond what a winner needs carry on to the next choice." },
  { key: "schulze", label: "Head-to-head", blurb: "Compares every pair of pizzas one on one (Schulze method, which also settles rock-paper-scissors loops)." },
  { key: "borda", label: "Borda", blurb: "Points for every pizza you placed below it, scaled so tasting fewer pizzas doesn't count against you." },
  { key: "adjusted", label: "Fullness-adjusted", blurb: "Average after removing the effect of slice order and of harsh or generous scorers." },
];

export const CATEGORY_LABELS = { platonic: "Platonic", non_platonic: "Non-platonic" };

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : NaN);
function median(xs) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function sd(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
}

// ballots: Map voterId -> Map pizzaId -> score, limited to one category.
export function ballotsFor(data, category) {
  const ids = new Set(data.pizzas.filter((p) => p.category === category).map((p) => p.id));
  const ballots = new Map();
  for (const { v, p, s } of data.scores) {
    if (!ids.has(p)) continue;
    if (!ballots.has(v)) ballots.set(v, new Map());
    ballots.get(v).set(p, s);
  }
  return { ids: [...ids], ballots };
}

function tiersOf(ballot) {
  const byScore = new Map();
  for (const [p, s] of ballot) {
    if (!byScore.has(s)) byScore.set(s, []);
    byScore.get(s).push(p);
  }
  return [...byScore.entries()].sort((a, b) => b[0] - a[0]).map(([, ps]) => ps);
}

export function stats(ids, ballots) {
  const out = new Map();
  for (const id of ids) {
    const xs = [];
    for (const b of ballots.values()) if (b.has(id)) xs.push(b.get(id));
    out.set(id, { n: xs.length, mean: mean(xs), median: median(xs), sd: sd(xs), scores: xs });
  }
  return out;
}

// Orders ids by a value map, highest first; ties and missing values fall
// back to the average, then to id so every method is deterministic.
function rankByValue(ids, value, st) {
  const v = (id) => (Number.isFinite(value.get(id)) ? value.get(id) : -Infinity);
  const avg = (id) => (Number.isFinite(st.get(id).mean) ? st.get(id).mean : -Infinity);
  return [...ids].sort((a, b) => v(b) - v(a) || avg(b) - avg(a) || a - b);
}

function firsts(ids, ballots) {
  const count = new Map(ids.map((id) => [id, 0]));
  for (const b of ballots.values()) {
    const top = tiersOf(b)[0] || [];
    for (const p of top) count.set(p, count.get(p) + 1 / top.length);
  }
  return count;
}

function irvRun(tiered, candidates, st) {
  const cont = new Set(candidates);
  const rounds = [];
  const weaker = (a, b) => (st.get(a).mean || 0) - (st.get(b).mean || 0) || b - a;
  while (cont.size > 1) {
    const tally = new Map([...cont].map((c) => [c, 0]));
    let active = 0;
    for (const tiers of tiered) {
      const tier = tiers.map((t) => t.filter((p) => cont.has(p))).find((t) => t.length);
      if (!tier) continue;
      active += 1;
      for (const p of tier) tally.set(p, tally.get(p) + 1 / tier.length);
    }
    const sorted = [...cont].sort((a, b) => tally.get(b) - tally.get(a) || weaker(b, a));
    if (active && tally.get(sorted[0]) > active / 2) {
      rounds.push({ tally, active, winner: sorted[0] });
      return { winner: sorted[0], rounds };
    }
    const loser = sorted[sorted.length - 1];
    rounds.push({ tally, active, eliminated: loser });
    cont.delete(loser);
  }
  const winner = [...cont][0];
  rounds.push({ tally: new Map([[winner, 0]]), active: 0, winner });
  return { winner, rounds };
}

// Full ranking by repeated runoffs: the winner takes 1st, then the count is
// rerun without them for 2nd, and so on.
function irv(ids, ballots, st) {
  const tiered = [...ballots.values()].map(tiersOf);
  const voted = ids.filter((id) => st.get(id).n > 0);
  const remaining = new Set(voted);
  const ranking = [];
  let firstRounds = [];
  while (remaining.size) {
    const run = irvRun(tiered, [...remaining], st);
    if (!ranking.length) firstRounds = run.rounds;
    ranking.push(run.winner);
    remaining.delete(run.winner);
  }
  return { ranking: [...ranking, ...ids.filter((id) => !remaining.has(id) && !ranking.includes(id))], rounds: firstRounds };
}

// STV with fractional (Gregory) surplus transfers and the Droop quota.
// A ballot that ties several continuing pizzas is split evenly between them.
function stv(ids, ballots, st, seats = 3) {
  const voted = ids.filter((id) => st.get(id).n > 0);
  seats = Math.min(seats, voted.length);
  const cont = new Set(voted);
  const elected = [];
  const rounds = [];
  const quota = ballots.size / (seats + 1);
  let parcels = [...ballots.values()].map((b) => ({ tiers: tiersOf(b), w: 1 }));

  const allocate = () => {
    const out = [];
    const stack = [...parcels];
    while (stack.length) {
      const parcel = stack.pop();
      const i = parcel.tiers.findIndex((t) => t.some((p) => cont.has(p)));
      if (i < 0) continue;
      const live = parcel.tiers[i].filter((p) => cont.has(p));
      if (live.length === 1) {
        out.push({ ...parcel, top: live[0] });
        continue;
      }
      for (const p of live) {
        const rest = parcel.tiers[i].filter((q) => q !== p);
        stack.push({ tiers: [[p], rest, ...parcel.tiers.slice(i + 1)], w: parcel.w / live.length });
      }
    }
    parcels = out;
    const tally = new Map([...cont].map((c) => [c, 0]));
    for (const p of parcels) tally.set(p.top, tally.get(p.top) + p.w);
    return tally;
  };

  const weaker = (a, b) => (st.get(a).mean || 0) - (st.get(b).mean || 0) || b - a;
  while (elected.length < seats && cont.size) {
    const tally = allocate();
    const order = [...cont].sort((a, b) => tally.get(b) - tally.get(a) || weaker(b, a));
    if (cont.size <= seats - elected.length) {
      for (const c of order) elected.push(c);
      rounds.push({ tally, electedAll: order });
      break;
    }
    const top = order[0];
    if (tally.get(top) > quota) {
      const factor = (tally.get(top) - quota) / tally.get(top);
      for (const p of parcels) if (p.top === top) p.w *= factor;
      elected.push(top);
      cont.delete(top);
      rounds.push({ tally, elected: top });
    } else {
      const loser = order[order.length - 1];
      cont.delete(loser);
      rounds.push({ tally, eliminated: loser });
    }
  }
  return { ranking: elected, rounds, quota, seats };
}

function schulze(ids, ballots, st) {
  const voted = ids.filter((id) => st.get(id).n > 0);
  const d = new Map(voted.map((a) => [a, new Map(voted.map((b) => [b, 0]))]));
  const both = new Map(voted.map((a) => [a, new Map(voted.map((b) => [b, 0]))]));
  for (const b of ballots.values()) {
    for (const x of voted) {
      if (!b.has(x)) continue;
      for (const y of voted) {
        if (x === y || !b.has(y)) continue;
        both.get(x).set(y, both.get(x).get(y) + 1);
        if (b.get(x) > b.get(y)) d.get(x).set(y, d.get(x).get(y) + 1);
      }
    }
  }
  const p = new Map(voted.map((a) => [a, new Map()]));
  for (const a of voted) for (const b of voted) if (a !== b) p.get(a).set(b, d.get(a).get(b) > d.get(b).get(a) ? d.get(a).get(b) : 0);
  for (const i of voted)
    for (const j of voted)
      if (i !== j)
        for (const k of voted)
          if (k !== i && k !== j) p.get(j).set(k, Math.max(p.get(j).get(k), Math.min(p.get(j).get(i), p.get(i).get(k))));

  const wins = new Map(voted.map((a) => [a, voted.filter((b) => b !== a && p.get(a).get(b) > p.get(b).get(a)).length]));
  const condorcet = voted.find((a) => voted.every((b) => b === a || d.get(a).get(b) > d.get(b).get(a))) ?? null;
  const ranking = rankByValue(ids, wins, st);
  return { ranking, pairwise: d, both, condorcet };
}

function borda(ids, ballots, st) {
  const pts = new Map(ids.map((id) => [id, []]));
  for (const b of ballots.values()) {
    if (b.size < 2) continue;
    for (const [x, sx] of b) {
      let beat = 0;
      for (const [y, sy] of b) if (y !== x) beat += sx > sy ? 1 : sx === sy ? 0.5 : 0;
      pts.get(x).push(beat / (b.size - 1));
    }
  }
  const value = new Map(ids.map((id) => [id, mean(pts.get(id))]));
  return { ranking: rankByValue(ids, value, st), value };
}

// score = mu + pizza + voter + slope * (slice number - average slice number),
// fitted by alternating least squares over every category, so the slope uses
// all the data. Pizza effects are reported at the average slice and voter.
export function fullnessModel(data) {
  const obs = data.scores;
  if (obs.length < 3) return { slope: 0, value: new Map(), mu: NaN };
  const meanPos = mean(obs.map((o) => o.pos));
  const xs = obs.map((o) => o.pos - meanPos);
  const sxx = sum(xs.map((x) => x * x));
  let mu = mean(obs.map((o) => o.s));
  let slope = 0;
  const a = new Map();
  const b = new Map();
  const get = (m, k) => m.get(k) || 0;

  const update = (map, key, other) => {
    const acc = new Map();
    obs.forEach((o, i) => {
      const r = o.s - mu - get(other, o[key === "p" ? "v" : "p"]) - slope * xs[i];
      const k = o[key];
      const e = acc.get(k) || [0, 0];
      acc.set(k, [e[0] + r, e[1] + 1]);
    });
    for (const [k, [t, n]] of acc) map.set(k, t / n);
    const shift = mean(obs.map((o) => map.get(o[key])));
    for (const k of map.keys()) map.set(k, map.get(k) - shift);
    mu += shift;
  };

  for (let iter = 0; iter < 200; iter++) {
    update(a, "p", b);
    update(b, "v", a);
    if (sxx > 0) {
      const r = obs.map((o, i) => o.s - mu - get(a, o.p) - get(b, o.v));
      slope = sum(r.map((ri, i) => ri * xs[i])) / sxx;
    }
  }
  const value = new Map([...a].map(([p, e]) => [p, mu + e]));
  return { slope, value, mu };
}

export function rank(method, ids, ballots, st, data) {
  switch (method) {
    case "average":
      return rankByValue(ids, new Map(ids.map((id) => [id, st.get(id).mean])), st);
    case "firsts":
      return rankByValue(ids, firsts(ids, ballots), st);
    case "irv":
      return irv(ids, ballots, st).ranking;
    case "stv":
      return stv(ids, ballots, st).ranking;
    case "schulze":
      return schulze(ids, ballots, st).ranking;
    case "borda":
      return borda(ids, ballots, st).ranking;
    case "adjusted":
      return rankByValue(ids, fullnessModel(data).value, st);
    default:
      throw new Error(`unknown method ${method}`);
  }
}

export function analyse(data, category) {
  const { ids, ballots } = ballotsFor(data, category);
  const st = stats(ids, ballots);
  const fm = fullnessModel(data);
  const f = firsts(ids, ballots);
  const irvResult = irv(ids, ballots, st);
  const stvResult = stv(ids, ballots, st);
  const sch = schulze(ids, ballots, st);
  const bor = borda(ids, ballots, st);
  return {
    ids,
    ballots,
    stats: st,
    rankings: {
      average: rank("average", ids, ballots, st, data),
      firsts: rankByValue(ids, f, st),
      irv: irvResult.ranking,
      stv: stvResult.ranking,
      schulze: sch.ranking,
      borda: bor.ranking,
      adjusted: rankByValue(ids, fm.value, st),
    },
    values: {
      average: new Map(ids.map((id) => [id, st.get(id).mean])),
      firsts: f,
      borda: bor.value,
      adjusted: fm.value,
    },
    irvRounds: irvResult.rounds,
    stv: stvResult,
    pairwise: sch.pairwise,
    pairBoth: sch.both,
    condorcet: sch.condorcet,
    slope: fm.slope,
  };
}

function pearson(xs, ys) {
  if (xs.length < 3) return NaN;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : NaN;
}

// Per-person stats across every category: agreement with everyone else's
// average, hot takes, and the person with the most similar scores.
export function person(data, voterId) {
  const mine = data.scores.filter((o) => o.v === voterId);
  const others = new Map();
  for (const o of data.scores) {
    if (o.v === voterId) continue;
    if (!others.has(o.p)) others.set(o.p, []);
    others.get(o.p).push(o.s);
  }
  const paired = mine.filter((o) => others.has(o.p));
  const agreement = pearson(
    paired.map((o) => o.s),
    paired.map((o) => mean(others.get(o.p)))
  );
  const hotTakes = paired
    .map((o) => ({ p: o.p, s: o.s, others: mean(others.get(o.p)), diff: o.s - mean(others.get(o.p)) }))
    .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff))
    .slice(0, 3);

  const byVoter = new Map();
  for (const o of data.scores) {
    if (!byVoter.has(o.v)) byVoter.set(o.v, new Map());
    byVoter.get(o.v).set(o.p, o.s);
  }
  const me = byVoter.get(voterId) || new Map();
  let twin = null;
  for (const [v, theirs] of byVoter) {
    if (v === voterId) continue;
    const shared = [...me.keys()].filter((p) => theirs.has(p));
    const r = pearson(
      shared.map((p) => me.get(p)),
      shared.map((p) => theirs.get(p))
    );
    if (Number.isFinite(r) && (!twin || r > twin.r)) twin = { v, r, shared: shared.length };
  }
  return {
    ranking: [...mine].sort((x, y) => y.s - x.s),
    agreement,
    hotTakes,
    twin,
  };
}

export function agreementLeague(data) {
  return data.voters
    .map((v) => ({ v: v.id, r: person(data, v.id).agreement }))
    .filter((x) => Number.isFinite(x.r))
    .sort((a, b) => b.r - a.r);
}
