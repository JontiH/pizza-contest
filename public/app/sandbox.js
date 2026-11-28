// Admin-only practice run of the Vote tab. Everything stays in the browser:
// fake pizzas, no API calls, nothing reaches the real tastings or results.
const FAKE = ["", "Pepperoni", "", "Mushroom", "Margherita", "Hawaiian"];

// lineup: pizzas from /api/board. Every one counts as on the table.
export function newSandbox(lineup = null) {
  const pizzas = lineup?.length
    ? lineup.map((p, i) => ({ pizza_id: p.id, box: p.box ?? i + 1, restaurant: p.restaurant, kind: p.kind, category: p.category }))
    : FAKE.map((kind, i) => ({
        pizza_id: i + 1,
        box: i + 1,
        restaurant: `Test Pizzeria ${String.fromCharCode(65 + i)}`,
        kind,
        category: kind ? "non_platonic" : "platonic",
      }));
  const s = { pizzas, scored: [], current: null, next: null, skipped: new Set() };
  advance(s);
  return s;
}

const untried = (s) =>
  s.pizzas.filter((p) => !s.scored.some((x) => x.pizza_id === p.pizza_id) && p.pizza_id !== s.current?.pizza_id && p.pizza_id !== s.next?.pizza_id);
const pickFrom = (list) => list[Math.floor(Math.random() * list.length)] ?? null;

function advance(s) {
  if (!s.current) {
    const taken = s.next ?? pickFrom(untried(s).filter((p) => !s.skipped.has(p.pizza_id))) ?? pickFrom(untried(s));
    s.next = null;
    if (taken) s.skipped.delete(taken.pizza_id);
    s.current = taken && { ...taken, position: s.scored.length + 1 };
  }
  if (s.current && !s.next) s.next = pickFrom(untried(s).filter((p) => !s.skipped.has(p.pizza_id)));
}

export function sandboxTasting(s, allowSkip) {
  return {
    phase: "tasting",
    checkedIn: true,
    allowSkip,
    current: s.current,
    next: s.next,
    scored: s.scored,
    left: untried(s).length,
  };
}

export function sandboxScore(s, pizzaId, score, note) {
  if (s.current?.pizza_id === pizzaId) {
    s.scored.push({ ...s.current, score: Number(score), note: note || "" });
    s.current = null;
    advance(s);
    return;
  }
  const row = s.scored.find((x) => x.pizza_id === pizzaId);
  if (!row) return;
  if (score !== undefined) row.score = Number(score);
  if (note !== undefined) row.note = note;
}

export function sandboxSkip(s) {
  if (!s.current) return;
  s.skipped.add(s.current.pizza_id);
  s.current = null;
  advance(s);
}

export function sandboxNext(s) {
  advance(s);
}
