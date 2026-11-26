import { bad } from "./http.js";

// Hands out the next slice. Among pizzas on the table they haven't tried, it
// prefers the one eaten least often as anyone's Nth slice (N being the slice
// this taster is on), so every pizza gets a mix of hungry and full tasters.
// Late pizzas have low early-position counts, so the next arrivals get them
// first. Skipped pizzas come last; ties go to the least crowded box, then
// random. The slice after that is picked ahead of time (the "up next" slice)
// so the taster can heat it while eating the current one.
export async function nextSlice(env, userId) {
  const current = await currentSlice(env, userId);
  if (current) return current;

  const position = (await scoredCount(env, userId)) + 1;
  const queued = await upNext(env, userId);
  if (queued) {
    await env.DB.prepare(`UPDATE tastings SET queued = 0, position = ? WHERE user_id = ? AND pizza_id = ?`)
      .bind(position, userId, queued.pizza_id)
      .run();
  } else {
    const pick = await choose(env, userId, position, true);
    if (!pick) return null;
    await assign(env, userId, pick.id, position, 0);
  }
  await fillQueue(env, userId);
  return currentSlice(env, userId);
}

// Makes sure a taster who has a current slice also has an up-next one, if
// anything untried is left. Skipped pizzas aren't queued.
export async function fillQueue(env, userId) {
  if (!(await currentSlice(env, userId)) || (await upNext(env, userId))) return;
  const pick = await choose(env, userId, (await scoredCount(env, userId)) + 2, false);
  if (pick) await assign(env, userId, pick.id, (await scoredCount(env, userId)) + 2, 1);
}

async function scoredCount(env, userId) {
  return env.DB.prepare(`SELECT COUNT(*) AS n FROM tastings WHERE user_id = ? AND score IS NOT NULL`).bind(userId).first("n");
}

async function choose(env, userId, position, allowSkipped) {
  const { results: candidates } = await env.DB.prepare(
    `SELECT p.id,
            COALESCE(t.skipped, 0) AS skipped,
            (SELECT COUNT(*) FROM tastings x WHERE x.pizza_id = p.id AND x.position = ? AND x.skipped = 0) AS at_position,
            (SELECT COUNT(*) FROM tastings x WHERE x.pizza_id = p.id AND x.score IS NULL AND x.skipped = 0) AS crowd
       FROM pizzas p
       LEFT JOIN tastings t ON t.pizza_id = p.id AND t.user_id = ?
      WHERE p.arrived_at IS NOT NULL AND p.finished_at IS NULL
        AND (t.pizza_id IS NULL OR (t.skipped = 1 AND t.score IS NULL AND ?))`
  )
    .bind(position, userId, allowSkipped ? 1 : 0)
    .all();
  for (const c of candidates) c.rand = Math.random();
  candidates.sort((a, b) => a.skipped - b.skipped || a.at_position - b.at_position || a.crowd - b.crowd || a.rand - b.rand);
  return candidates[0] ?? null;
}

function assign(env, userId, pizzaId, position, queued) {
  return env.DB.prepare(
    `INSERT INTO tastings (user_id, pizza_id, position, skipped, queued, assigned_at) VALUES (?, ?, ?, 0, ?, datetime('now'))
     ON CONFLICT (user_id, pizza_id) DO UPDATE SET position = excluded.position, skipped = 0, queued = excluded.queued, assigned_at = excluded.assigned_at`
  )
    .bind(userId, pizzaId, position, queued)
    .run();
}

export function currentSlice(env, userId) {
  return env.DB.prepare(
    `SELECT t.pizza_id, t.position, p.box, p.restaurant, p.kind, p.category
       FROM tastings t JOIN pizzas p ON p.id = t.pizza_id
      WHERE t.user_id = ? AND t.score IS NULL AND t.skipped = 0 AND t.queued = 0`
  )
    .bind(userId)
    .first();
}

export function upNext(env, userId) {
  return env.DB.prepare(
    `SELECT t.pizza_id, p.box, p.restaurant, p.kind, p.category
       FROM tastings t JOIN pizzas p ON p.id = t.pizza_id
      WHERE t.user_id = ? AND t.queued = 1`
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
  // Hand out a different slice right away (the up-next one if there is one);
  // the skipped one returns once nothing else is left.
  return nextSlice(env, userId);
}

export function parseScore(value) {
  const n = typeof value === "string" ? Number(value.replace(",", ".")) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 10) throw bad("score must be between 0 and 10");
  return Math.round(n * 100) / 100;
}

// score or note may be undefined to leave that one unchanged. A note needs
// a score first, so notes can't be left on pizzas nobody has rated.
export async function scoreSlice(env, userId, pizzaId, score, note) {
  const row = await env.DB.prepare(`SELECT skipped, queued, score FROM tastings WHERE user_id = ? AND pizza_id = ?`)
    .bind(userId, pizzaId)
    .first();
  if (!row || row.skipped || row.queued) throw bad("you can only score slices you've been given");
  if (score === undefined && row.score === null) throw bad("score it before adding a note");
  await env.DB.prepare(
    `UPDATE tastings SET score = COALESCE(?, score), note = COALESCE(?, note),
            scored_at = COALESCE(scored_at, datetime('now'))
      WHERE user_id = ? AND pizza_id = ?`
  )
    .bind(score ?? null, note ?? null, userId, pizzaId)
    .run();
}
