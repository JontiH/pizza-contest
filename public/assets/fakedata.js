// Made-up ballots in the same shape as /api/results, for the admin test
// mode (?test on the results and count pages). Nothing here touches the
// server. The same seed gives the same data.
const CHEESE = ["Test Pizzeria A", "Test Pizzeria B", "Test Pizzeria C", "Test Pizzeria D", "Test Pizzeria E", "Test Pizzeria F"];
const OTHER = [
  ["Test Slice House", "Pepperoni"],
  ["Test Pie Co", "Mushroom"],
  ["Test Oven", "Hawaiian"],
  ["Test Napoli", "Margherita"],
  ["Test Corner", "Sausage and peppers"],
  ["Test Brick", "Vodka"],
  ["Test Crust", "Veggie"],
  ["Test Fire", "Buffalo chicken"],
];
const NAMES = ["Alex", "Bea", "Chris", "Dana", "Eli", "Fern", "Gus", "Hana", "Ivy", "Jo", "Kit", "Lou", "Max", "Nia", "Oz", "Pat", "Quinn", "Rae", "Sam", "Tess", "Uma", "Val"];
const NOTES = ["Great crust", "Too greasy", "Cold by the time I got it", "Loved the sauce", "Bland", "Needs more cheese", "Would eat again", ""];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// lineup: pizzas from /api/board (optional). Every pizza in it is treated as
// on the table and keeps its real ID. me: { name, scores: [{ p, s, note, pos }] }
// adds the viewer as voter 0; with no scores they get made-up ones too.
// Scores come back in the order guests would plausibly submit them
// (everyone's first slice, then second slices, and so on).
export function fakeResults(seed = 1, lineup = null, guests = 22, me = null) {
  const rand = rng(seed);
  const gauss = () => (rand() + rand() + rand() + rand() - 2) * 1.2;

  const base = lineup?.length
    ? lineup.map((p) => ({ id: p.id, restaurant: p.restaurant, kind: p.kind, category: p.category, champion: !!p.champion, placing: p.placing ?? null, bringer: p.bringer ?? "", box: p.box }))
    : [
        ...CHEESE.map((restaurant) => ({ restaurant, kind: "", category: "platonic" })),
        ...OTHER.map(([restaurant, kind]) => ({ restaurant, kind, category: "non_platonic" })),
      ].map((p, i) => ({
        ...p,
        champion: i === 0 || i === 1 || i === 6,
        placing: i === 0 ? 1 : i === 1 ? 2 : i === 6 ? 1 : null,
        bringer: NAMES[(i * 3) % NAMES.length],
      }));
  const pizzas = base.map((p, i) => ({ ...p, id: p.id ?? i + 1, box: p.box ?? i + 1, quality: 4.5 + rand() * 4 }));
  const quality = new Map(pizzas.map((p) => [p.id, p.quality]));
  const names = me ? [me.name, ...NAMES.filter((n) => n !== me.name)] : NAMES;
  const voters = Array.from({ length: Math.max(3, guests) }, (_, id) => ({ id, name: names[id] ?? `Guest ${id + 1}` }));

  const scores = [];
  for (const v of voters) {
    if (me?.scores?.length && v.id === 0) {
      for (const o of me.scores) scores.push({ v: 0, p: o.p, pos: o.pos, s: o.s, note: o.note || "" });
      continue;
    }
    const bias = gauss();
    const order = pizzas.map((p) => p.id).sort(() => rand() - 0.5);
    const tried = order.slice(0, Math.min(order.length, 8 + Math.floor(rand() * 7)));
    tried.forEach((pid, i) => {
      const q = quality.get(pid);
      const s = Math.min(10, Math.max(0, q + bias - i * 0.08 + gauss()));
      scores.push({ v: v.id, p: pid, pos: i + 1, s: Math.round(s * 10) / 10, note: rand() < 0.25 ? NOTES[Math.floor(rand() * NOTES.length)] : "" });
    });
  }
  scores.sort((a, b) => a.pos + rand() * 2 - (b.pos + rand() * 2));
  return {
    officialMethod: "",
    pizzas: pizzas.map(({ quality, ...p }) => p),
    voters,
    scores,
  };
}

// The first n scores, with only the guests who have voted so far.
export function firstScores(full, n) {
  const scores = full.scores.slice(0, n);
  const seen = new Set(scores.map((o) => o.v));
  return { ...full, scores, voters: full.voters.filter((v) => seen.has(v.id)) };
}
