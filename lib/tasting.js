import { bad } from "./http.js";

// Picks the next slice for a taster. Among pizzas on the table they haven't
// tried, it prefers the one eaten least often as anyone's Nth slice (N being
// the slice this taster is on), so every pizza gets a mix of hungry and full
// tasters. Late pizzas have low early-position counts, so the next arrivals
// get them first. Skipped pizzas come last; ties go to the least crowded box,
// then random.
export async function nextSlice(env, userId) {
  const current = await currentSlice(env, userId);
  if (current) return current;

  const position =
    (await env.DB.prepare(`SELECT COUNT(*) AS n FROM tastings WHERE user_id = ? AND score IS NOT NULL`)
      .bind(userId)
      .first("n")) + 1;

  const { results: candidates } = await env.DB.prepare(
    `SELECT p.id,
            COALESCE(t.skipped, 0) AS skipped,
            (SELECT COUNT(*) FROM tastings x WHERE x.pizza_id = p.id AND x.position = ? AND x.skipped = 0) AS at_position,
            (SELECT COUNT(*) FROM tastings x WHERE x.pizza_id = p.id AND x.score IS NULL AND x.skipped = 0) AS crowd
       FROM pizzas p
       LEFT JOIN tastings t ON t.pizza_id = p.id AND t.user_id = ?
      WHERE p.arrived_at IS NOT NULL AND p.finished_at IS NULL
        AND (t.pizza_id IS NULL OR (t.skipped = 1 AND t.score IS NULL))`
  )
    .bind(position, userId)
    .all();
  if (!candidates.length) return null;

  for (const c of candidates) c.rand = Math.random();
  candidates.sort((a, b) => a.skipped - b.skipped || a.at_position - b.at_position || a.crowd - b.crowd || a.rand - b.rand);
  const pick = candidates[0];

  await env.DB.prepare(
    `INSERT INTO tastings (user_id, pizza_id, position, skipped, assigned_at) VALUES (?, ?, ?, 0, datetime('now'))
     ON CONFLICT (user_id, pizza_id) DO UPDATE SET position = excluded.position, skipped = 0, assigned_at = excluded.assigned_at`
  )
    .bind(userId, pick.id, position)
    .run();
  return currentSlice(env, userId);
}

export function currentSlice(env, userId) {
  return env.DB.prepare(
    `SELECT t.pizza_id, t.position, p.box, p.restaurant, p.kind, p.category
       FROM tastings t JOIN pizzas p ON p.id = t.pizza_id
      WHERE t.user_id = ? AND t.score IS NULL AND t.skipped = 0`
  )
    .bind(userId)
    .first();
}

export async function skipSlice(env, userId) {
  const current = await currentSlice(env, userId);
  if (!current) throw bad("you don't have a slice to skip");
  await env.DB.prepare(`UPDATE tastings SET skipped = 1 WHERE user_id = ? AND pizza_id = ?`)
    .bind(userId, current.pizza_id)
    .run();
  // Hand out a different slice right away; the skipped one returns once
  // nothing else is left.
  return nextSlice(env, userId);
}

export function parseScore(value) {
  const n = typeof value === "string" ? Number(value.replace(",", ".")) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 1 || n > 10) throw bad("score must be between 1 and 10");
  return Math.round(n * 100) / 100;
}

export async function scoreSlice(env, userId, pizzaId, score) {
  const row = await env.DB.prepare(`SELECT skipped FROM tastings WHERE user_id = ? AND pizza_id = ?`)
    .bind(userId, pizzaId)
    .first();
  if (!row || row.skipped) throw bad("you can only score slices you've been given");
  await env.DB.prepare(
    `UPDATE tastings SET score = ?, scored_at = COALESCE(scored_at, datetime('now')) WHERE user_id = ? AND pizza_id = ?`
  )
    .bind(score, userId, pizzaId)
    .run();
}
