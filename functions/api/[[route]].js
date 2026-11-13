import { isAdmin, logout, sessionEmail } from "../../lib/auth.js";
import { HttpError, bad, handle, json, readJson, text } from "../../lib/http.js";
import { buildResults } from "../../lib/results.js";
import { guessPlace, locationFromMapsLink, parseLocation, searchPlaces } from "../../lib/places.js";
import { currentSlice, nextSlice, parseScore, scoreSlice, skipSlice } from "../../lib/tasting.js";

const PHASES = ["signup", "tasting", "closed", "revealed"];
const CATEGORIES = ["platonic", "non_platonic"];
const METHODS = ["", "average", "firsts", "irv", "stv", "schulze", "borda", "adjusted"];

// Every /api route needs a logged-in session. Routes below this check can
// assume ctx.email is a verified address.
export function onRequest({ request, env, params }) {
  return handle(async () => {
    const email = await sessionEmail(request, env);
    if (!email) throw new HttpError(401, "log in first");

    const user = await env.DB.prepare(`SELECT * FROM users WHERE email = ?`).bind(email).first();
    const settings = Object.fromEntries(
      (await env.DB.prepare(`SELECT key, value FROM settings`).all()).results.map((s) => [s.key, s.value])
    );
    const ctx = { request, env, email, user, settings, admin: isAdmin(env, email) };
    const path = (params.route || []).join("/");
    return route(ctx, request.method, path);
  });
}

async function route(ctx, method, path) {
  const m = (pattern) => path.match(pattern);
  let match;

  if (path === "me" && method === "GET") return json(me(ctx));
  if (path === "me" && method === "POST") return json(await register(ctx, await readJson(ctx.request)));
  if (path === "logout" && method === "POST") return logout(ctx.request, ctx.env);

  // Below here: approved guests only.
  if (!ctx.user || ctx.user.status !== "approved") throw new HttpError(403, "waiting for approval");

  if (path === "board" && method === "GET") return json(await board(ctx));
  if (path === "places" && method === "GET") return json({ results: await searchPlaces(ctx.env, new URL(ctx.request.url).searchParams.get("q")) });
  if (path === "pizzas" && method === "POST") return json(await addPizza(ctx, await readJson(ctx.request)), 201);
  if ((match = m(/^pizzas\/(\d+)$/)) && method === "PATCH") return json(await editPizza(ctx, +match[1], await readJson(ctx.request)));
  if ((match = m(/^pizzas\/(\d+)$/)) && method === "DELETE") return json(await removePizza(ctx, +match[1]));
  if ((match = m(/^pizzas\/(\d+)\/(claim|unclaim)$/)) && method === "POST") {
    await readJson(ctx.request);
    return json(await claim(ctx, +match[1], match[2] === "claim"));
  }

  if (path === "tasting" && method === "GET") return json(await tasting(ctx));
  if (path === "tasting/next" && method === "POST") {
    await readJson(ctx.request);
    requireTasting(ctx);
    return json({ current: await nextSlice(ctx.env, ctx.user.id) });
  }
  if (path === "tasting/skip" && method === "POST") {
    await readJson(ctx.request);
    requireTasting(ctx);
    return json({ current: await skipSlice(ctx.env, ctx.user.id) });
  }
  if (path === "tasting/score" && method === "PUT") {
    const body = await readJson(ctx.request);
    if (ctx.settings.phase !== "tasting") throw bad("scoring is closed");
    const score = body.score === undefined ? undefined : parseScore(body.score);
    const note = body.note === undefined ? undefined : text(body.note, "note", 280);
    if (score === undefined && note === undefined) throw bad("send a score or a note");
    await scoreSlice(ctx.env, ctx.user.id, Number(body.pizza_id), score, note);
    return json({ ok: true });
  }

  if (path === "results" && method === "GET") {
    if (!["closed", "revealed"].includes(ctx.settings.phase)) throw new HttpError(403, "results come out after voting closes");
    return json(await buildResults(ctx.env, { includeBringer: true }));
  }

  if (path.startsWith("admin")) {
    if (!ctx.admin) throw new HttpError(403, "admins only");
    return admin(ctx, method, path.slice("admin".length).replace(/^\//, ""));
  }

  throw new HttpError(404, "not found");
}

function me(ctx) {
  const { user, settings } = ctx;
  return {
    email: ctx.email,
    registered: !!user,
    name: user?.name ?? null,
    status: user?.status ?? null,
    checkedIn: !!user?.checked_in_at,
    admin: ctx.admin,
    phase: settings.phase,
    officialMethod: settings.official_method,
  };
}

async function register(ctx, body) {
  const name = text(body.name, "display name", 30, true);
  try {
    if (ctx.user) {
      await ctx.env.DB.prepare(`UPDATE users SET name = ? WHERE id = ?`).bind(name, ctx.user.id).run();
    } else {
      // The admin is approved on sign-up; everyone else waits for the admin.
      await ctx.env.DB.prepare(`INSERT INTO users (email, name, status) VALUES (?, ?, ?)`)
        .bind(ctx.email, name, ctx.admin ? "approved" : "pending")
        .run();
    }
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) throw new HttpError(409, "someone already has that name");
    throw e;
  }
  return { ok: true };
}

function requireTasting(ctx) {
  if (ctx.settings.phase !== "tasting") throw bad("tasting isn't open");
  if (!ctx.user.checked_in_at) throw bad("find the host to check in first");
}

function requireLineupOpen(ctx) {
  if (!["signup", "tasting"].includes(ctx.settings.phase)) throw bad("the lineup is locked");
}

async function board(ctx) {
  const [pizzas, guests] = await ctx.env.DB.batch([
    ctx.env.DB.prepare(
      `SELECT p.id, p.restaurant, p.kind, p.notes, p.category, p.champion, p.placing, p.box, p.bringer_id, p.lat, p.lon, p.address,
              p.arrived_at IS NOT NULL AS arrived, p.finished_at IS NOT NULL AS finished, u.name AS bringer
         FROM pizzas p LEFT JOIN users u ON u.id = p.bringer_id
        ORDER BY p.champion DESC, p.id`
    ),
    ctx.env.DB.prepare(
      `SELECT u.name, u.checked_in_at IS NOT NULL AS checked_in,
              EXISTS (SELECT 1 FROM pizzas p WHERE p.bringer_id = u.id) AS bringing
         FROM users u WHERE u.status = 'approved' ORDER BY lower(u.name)`
    ),
  ]);
  return {
    phase: ctx.settings.phase,
    pizzas: pizzas.results.map(({ bringer_id, ...p }) => ({
      ...p,
      champion: !!p.champion,
      arrived: !!p.arrived,
      finished: !!p.finished,
      mine: bringer_id === ctx.user.id,
    })),
    guests: guests.results.map((g) => ({ ...g, checked_in: !!g.checked_in, bringing: !!g.bringing })),
  };
}

function parsePlacing(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (![1, 2, 3].includes(n)) throw bad("placing must be 1st, 2nd or 3rd");
  return n;
}

// Guests must say which pizza; champion slots and admin entries may leave
// it blank until someone knows.
function pizzaFields(body, { partial = false, requireKind = false } = {}) {
  const out = {};
  if (!partial || body.restaurant !== undefined) out.restaurant = text(body.restaurant, "restaurant", 60, true);
  if (!partial || body.kind !== undefined) out.kind = text(body.kind, "pizza", 60, requireKind);
  if (!partial || body.notes !== undefined) out.notes = text(body.notes, "notes", 140);
  if (!partial || body.category !== undefined) {
    if (!CATEGORIES.includes(body.category)) throw bad("pick a category");
    out.category = body.category;
  }
  return out;
}

// Uses the location the person picked, or looks the restaurant up.
async function withLocation(env, f, body) {
  const picked = parseLocation(body);
  if (picked) return { ...f, ...picked };
  const guess = await guessPlace(env, f.restaurant);
  return guess ? { ...f, lat: guess.lat, lon: guess.lon, address: guess.address } : { ...f, lat: null, lon: null, address: "" };
}

async function insertPizza(env, f, champion, bringerId) {
  try {
    const { id } = await env.DB.prepare(
      `INSERT INTO pizzas (restaurant, kind, notes, category, champion, placing, bringer_id, lat, lon, address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
    )
      .bind(f.restaurant, f.kind, f.notes, f.category, champion ? 1 : 0, champion ? (f.placing ?? null) : null, bringerId, f.lat, f.lon, f.address)
      .first();
    return { id };
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) throw new HttpError(409, "someone is already bringing that restaurant");
    throw e;
  }
}

async function addPizza(ctx, body) {
  requireLineupOpen(ctx);
  const own = await ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM pizzas WHERE bringer_id = ? AND champion = 0`)
    .bind(ctx.user.id)
    .first("n");
  if (own > 0) throw bad("you're already bringing a pizza; edit that one instead");
  return insertPizza(ctx.env, await withLocation(ctx.env, pizzaFields(body, { requireKind: true }), body), false, ctx.user.id);
}

async function ownPizza(ctx, id) {
  const p = await ctx.env.DB.prepare(`SELECT * FROM pizzas WHERE id = ?`).bind(id).first();
  if (!p) throw new HttpError(404, "no such pizza");
  if (p.bringer_id !== ctx.user.id) throw new HttpError(403, "that isn't your pizza");
  return p;
}

async function editPizza(ctx, id, body) {
  requireLineupOpen(ctx);
  const p = await ownPizza(ctx, id);
  // Champion slots are fixed by the admin; volunteers only say what kind.
  let f = p.champion
    ? pizzaFields({ kind: body.kind, notes: body.notes }, { partial: true })
    : pizzaFields(body, { partial: true, requireKind: true });
  if (!p.champion && f.restaurant !== undefined && f.restaurant !== p.restaurant) f = await withLocation(ctx.env, f, body);
  await updatePizza(ctx.env, id, f);
  return { ok: true };
}

async function updatePizza(env, id, f) {
  const keys = Object.keys(f);
  if (!keys.length) return;
  try {
    await env.DB.prepare(`UPDATE pizzas SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
      .bind(...keys.map((k) => f[k]), id)
      .run();
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) throw new HttpError(409, "someone is already bringing that restaurant");
    throw e;
  }
}

async function removePizza(ctx, id) {
  requireLineupOpen(ctx);
  const p = await ownPizza(ctx, id);
  if (p.champion) throw bad("champion slots can't be deleted; unclaim it instead");
  if (p.arrived_at) throw bad("it's already on the table; ask the host");
  await ctx.env.DB.prepare(`DELETE FROM pizzas WHERE id = ?`).bind(id).run();
  return { ok: true };
}

async function claim(ctx, id, claiming) {
  requireLineupOpen(ctx);
  const p = await ctx.env.DB.prepare(`SELECT * FROM pizzas WHERE id = ?`).bind(id).first();
  if (!p || !p.champion) throw bad("only champion slots can be claimed");
  if (claiming) {
    const { meta } = await ctx.env.DB.prepare(`UPDATE pizzas SET bringer_id = ? WHERE id = ? AND bringer_id IS NULL`)
      .bind(ctx.user.id, id)
      .run();
    if (!meta.changes) throw new HttpError(409, "someone already claimed it");
  } else {
    if (p.bringer_id !== ctx.user.id) throw new HttpError(403, "that isn't your claim");
    await ctx.env.DB.prepare(`UPDATE pizzas SET bringer_id = NULL WHERE id = ?`).bind(id).run();
  }
  return { ok: true };
}

async function tasting(ctx) {
  const { results: scored } = await ctx.env.DB.prepare(
    `SELECT t.pizza_id, t.position, t.score, t.note, p.box, p.restaurant, p.kind, p.category
       FROM tastings t JOIN pizzas p ON p.id = t.pizza_id
      WHERE t.user_id = ? AND t.score IS NOT NULL ORDER BY t.position`
  )
    .bind(ctx.user.id)
    .all();
  const left = await ctx.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM pizzas p
      WHERE p.arrived_at IS NOT NULL AND p.finished_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM tastings t WHERE t.pizza_id = p.id AND t.user_id = ? AND (t.score IS NOT NULL OR t.skipped = 0))`
  )
    .bind(ctx.user.id)
    .first("n");
  return {
    phase: ctx.settings.phase,
    checkedIn: !!ctx.user.checked_in_at,
    current: await currentSlice(ctx.env, ctx.user.id),
    scored,
    left,
  };
}

async function admin(ctx, method, path) {
  const { env } = ctx;
  let match;

  if (path === "" && method === "GET") {
    const [users, pizzas] = await env.DB.batch([
      env.DB.prepare(
        `SELECT u.id, u.email, u.name, u.status, u.checked_in_at IS NOT NULL AS checked_in, u.created_at,
                (SELECT COUNT(*) FROM tastings t WHERE t.user_id = u.id AND t.score IS NOT NULL) AS scored
           FROM users u ORDER BY u.status = 'pending' DESC, lower(u.name)`
      ),
      env.DB.prepare(
        `SELECT p.*, u.name AS bringer,
                (SELECT COUNT(*) FROM tastings t WHERE t.pizza_id = p.id AND t.score IS NOT NULL) AS scored
           FROM pizzas p LEFT JOIN users u ON u.id = p.bringer_id ORDER BY p.box IS NULL, p.box, p.id`
      ),
    ]);
    return json({
      settings: ctx.settings,
      users: users.results.map((u) => ({ ...u, checked_in: !!u.checked_in })),
      pizzas: pizzas.results.map((p) => ({ ...p, champion: !!p.champion })),
    });
  }

  if ((match = path.match(/^users\/(\d+)$/)) && method === "POST") {
    const id = +match[1];
    const body = await readJson(ctx.request);
    if (body.status !== undefined) {
      if (!["pending", "approved", "rejected"].includes(body.status)) throw bad("bad status");
      await env.DB.prepare(`UPDATE users SET status = ? WHERE id = ?`).bind(body.status, id).run();
    }
    if (body.checked_in === true) {
      await env.DB.prepare(`UPDATE users SET checked_in_at = COALESCE(checked_in_at, datetime('now')) WHERE id = ?`).bind(id).run();
      const { results } = await env.DB.prepare(`SELECT id FROM pizzas WHERE bringer_id = ? AND arrived_at IS NULL`).bind(id).all();
      for (const p of results) await arrive(env, p.id);
    } else if (body.checked_in === false) {
      await env.DB.prepare(`UPDATE users SET checked_in_at = NULL WHERE id = ?`).bind(id).run();
    }
    return json({ ok: true });
  }

  if (path === "pizzas" && method === "POST") {
    const body = await readJson(ctx.request);
    const bringer = body.bringer_id ? Number(body.bringer_id) : null;
    const fields = { ...pizzaFields(body), placing: parsePlacing(body.placing) };
    return json(await insertPizza(env, await withLocation(env, fields, body), !!body.champion, bringer), 201);
  }

  if ((match = path.match(/^pizzas\/(\d+)$/)) && method === "POST") {
    const id = +match[1];
    const body = await readJson(ctx.request);
    const f = pizzaFields(body, { partial: true });
    if (body.champion !== undefined) f.champion = body.champion ? 1 : 0;
    if (body.placing !== undefined) f.placing = parsePlacing(body.placing);
    if (body.bringer_id !== undefined) f.bringer_id = body.bringer_id ? Number(body.bringer_id) : null;
    if (typeof body.maps_link === "string" && body.maps_link.trim()) Object.assign(f, await locationFromMapsLink(body.maps_link));
    else Object.assign(f, parseLocation(body) || {});
    await updatePizza(env, id, f);
    if (body.arrived === true) await arrive(env, id);
    if (body.arrived === false) await env.DB.prepare(`UPDATE pizzas SET arrived_at = NULL WHERE id = ?`).bind(id).run();
    if (body.finished === true) await env.DB.prepare(`UPDATE pizzas SET finished_at = datetime('now') WHERE id = ?`).bind(id).run();
    if (body.finished === false) await env.DB.prepare(`UPDATE pizzas SET finished_at = NULL WHERE id = ?`).bind(id).run();
    return json({ ok: true });
  }

  if ((match = path.match(/^pizzas\/(\d+)$/)) && method === "DELETE") {
    const id = +match[1];
    const tasted = await env.DB.prepare(`SELECT COUNT(*) AS n FROM tastings WHERE pizza_id = ?`).bind(id).first("n");
    if (tasted) throw bad("people have already been given this pizza; mark it finished instead");
    await env.DB.prepare(`DELETE FROM pizzas WHERE id = ?`).bind(id).run();
    return json({ ok: true });
  }

  if (path === "settings" && method === "POST") {
    const body = await readJson(ctx.request);
    if (body.phase !== undefined) {
      if (!PHASES.includes(body.phase)) throw bad("bad phase");
      await env.DB.prepare(`UPDATE settings SET value = ? WHERE key = 'phase'`).bind(body.phase).run();
    }
    if (body.official_method !== undefined) {
      if (!METHODS.includes(body.official_method)) throw bad("bad method");
      await env.DB.prepare(`UPDATE settings SET value = ? WHERE key = 'official_method'`).bind(body.official_method).run();
    }
    return json({ ok: true });
  }

  throw new HttpError(404, "not found");
}

async function arrive(env, id) {
  await env.DB.prepare(
    `UPDATE pizzas SET arrived_at = datetime('now'),
            box = COALESCE(box, (SELECT COALESCE(MAX(box), 0) + 1 FROM pizzas))
      WHERE id = ? AND arrived_at IS NULL`
  )
    .bind(id)
    .run();
}
