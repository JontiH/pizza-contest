class BadRequest extends Error {}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

function text(value, field, max, required = false) {
  const s = typeof value === "string" ? value.trim() : "";
  if (required && !s) throw new BadRequest(`${field} is required`);
  if (s.length > max) throw new BadRequest(`${field} must be at most ${max} characters`);
  return s;
}

function voterId(value) {
  if (typeof value !== "string" || !/^[\w-]{8,64}$/.test(value)) throw new BadRequest("bad voter id");
  return value;
}

export async function onRequest({ request, env, params }) {
  const path = (params.route || []).join("/");
  const method = request.method;
  const url = new URL(request.url);

  // Writes need the shared party code when PARTY_CODE is set, so the public
  // URL can't be spammed by anyone who finds it.
  if (method !== "GET" && env.PARTY_CODE && request.headers.get("x-party-code") !== env.PARTY_CODE) {
    return json({ error: "party code required" }, 401);
  }

  try {
    if (method === "GET" && path === "state") return json(await getState(env, url.searchParams.get("voter")));
    if (method === "POST" && path === "pizzas") return json(await addPizza(env, await body(request)), 201);
    if (method === "DELETE" && /^pizzas\/\d+$/.test(path)) {
      return json(await deletePizza(env, Number(path.split("/")[1]), url.searchParams.get("voter")));
    }
    if (method === "PUT" && path === "votes") return json(await putVote(env, await body(request)));
    return json({ error: "not found" }, 404);
  } catch (e) {
    if (e instanceof BadRequest) return json({ error: e.message }, 400);
    throw e;
  }
}

async function body(request) {
  try {
    return await request.json();
  } catch {
    throw new BadRequest("body must be JSON");
  }
}

async function getState(env, voter) {
  const pizzas = await env.DB.prepare(
    `SELECT p.id, p.restaurant, p.pizza, p.style, p.brought_by, p.notes, p.creator_id,
            AVG(v.score) AS avg, COUNT(v.score) AS votes
       FROM pizzas p LEFT JOIN votes v ON v.pizza_id = p.id
      GROUP BY p.id ORDER BY p.id`
  ).all();

  const voters = await env.DB.prepare(
    `SELECT voter_name AS name, COUNT(*) AS votes FROM votes
      GROUP BY voter_id ORDER BY MIN(updated_at)`
  ).all();

  let mine = [];
  if (voter) {
    mine = (
      await env.DB.prepare(`SELECT pizza_id, score, note FROM votes WHERE voter_id = ?`).bind(voter).all()
    ).results;
  }

  return {
    pizzas: pizzas.results.map(({ creator_id, ...p }) => ({ ...p, mine: !!voter && creator_id === voter })),
    voters: voters.results,
    myVotes: mine,
  };
}

async function addPizza(env, b) {
  const row = {
    restaurant: text(b.restaurant, "restaurant", 80, true),
    pizza: text(b.pizza, "pizza", 80),
    style: text(b.style, "style", 40),
    brought_by: text(b.brought_by, "brought by", 40, true),
    notes: text(b.notes, "notes", 280),
    creator_id: voterId(b.voter_id),
  };
  const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM pizzas`).first("n");
  if (count >= 60) throw new BadRequest("the lineup is full");
  const { id } = await env.DB.prepare(
    `INSERT INTO pizzas (restaurant, pizza, style, brought_by, notes, creator_id)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`
  )
    .bind(row.restaurant, row.pizza, row.style, row.brought_by, row.notes, row.creator_id)
    .first();
  return { id };
}

async function deletePizza(env, id, voter) {
  const creator = await env.DB.prepare(`SELECT creator_id FROM pizzas WHERE id = ?`).bind(id).first("creator_id");
  if (!creator) throw new BadRequest("no such pizza");
  if (creator !== voter) throw new BadRequest("only the person who added a pizza can remove it");
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM votes WHERE pizza_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM pizzas WHERE id = ?`).bind(id),
  ]);
  return { ok: true };
}

async function putVote(env, b) {
  const voter = voterId(b.voter_id);
  const name = text(b.voter_name, "name", 40, true);
  const pizzaId = Number(b.pizza_id);
  if (!Number.isInteger(pizzaId)) throw new BadRequest("bad pizza id");
  const exists = await env.DB.prepare(`SELECT 1 FROM pizzas WHERE id = ?`).bind(pizzaId).first();
  if (!exists) throw new BadRequest("no such pizza");

  if (b.score === null) {
    await env.DB.prepare(`DELETE FROM votes WHERE pizza_id = ? AND voter_id = ?`).bind(pizzaId, voter).run();
    return { ok: true };
  }

  const score = Number(b.score);
  if (!Number.isInteger(score) || score < 1 || score > 10) throw new BadRequest("score must be 1 to 10");
  const note = text(b.note, "note", 280);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO votes (pizza_id, voter_id, voter_name, score, note, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT (pizza_id, voter_id) DO UPDATE SET
         voter_name = excluded.voter_name, score = excluded.score,
         note = excluded.note, updated_at = excluded.updated_at`
    ).bind(pizzaId, voter, name, score, note),
    // Renaming yourself applies to all your past votes, not just this one.
    env.DB.prepare(`UPDATE votes SET voter_name = ? WHERE voter_id = ?`).bind(name, voter),
  ]);
  return { ok: true };
}
