// Raw ballots for the tally code in public/assets/tally.js. Voters are
// renumbered so user IDs and emails never leave the server.
export async function buildResults(env, { includeBringer }) {
  const [pizzas, rows, settings] = await env.DB.batch([
    env.DB.prepare(
      `SELECT p.id, p.box, p.restaurant, p.kind, p.category, p.champion, u.name AS bringer
         FROM pizzas p LEFT JOIN users u ON u.id = p.bringer_id
        WHERE p.arrived_at IS NOT NULL ORDER BY p.box`
    ),
    env.DB.prepare(
      `SELECT t.user_id, u.name, t.pizza_id, t.position, t.score
         FROM tastings t JOIN users u ON u.id = t.user_id
        WHERE t.score IS NOT NULL AND u.status = 'approved'
        ORDER BY u.name, t.position`
    ),
    env.DB.prepare(`SELECT key, value FROM settings`),
  ]);

  const voterIndex = new Map();
  const voters = [];
  const scores = [];
  for (const r of rows.results) {
    if (!voterIndex.has(r.user_id)) {
      voterIndex.set(r.user_id, voters.length);
      voters.push({ id: voters.length, name: r.name });
    }
    scores.push({ v: voterIndex.get(r.user_id), p: r.pizza_id, pos: r.position, s: r.score });
  }

  const config = Object.fromEntries(settings.results.map((s) => [s.key, s.value]));
  return {
    officialMethod: config.official_method || "",
    pizzas: pizzas.results.map(({ bringer, champion, ...p }) => ({
      ...p,
      champion: !!champion,
      ...(includeBringer ? { bringer } : {}),
    })),
    voters,
    scores,
  };
}
