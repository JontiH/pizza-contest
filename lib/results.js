// Raw ballots for the tally code in public/assets/tally.js. Voters are
// renumbered so user IDs and emails never leave the server. viewerId's
// renumbered ID comes back as `you`, so the page can show their own section.
export async function buildResults(env, { includeBringer, viewerId = null }) {
  const [pizzas, rows, settings] = await env.DB.batch([
    env.DB.prepare(
      `SELECT p.id, p.box, p.restaurant, p.kind, p.category, p.champion, p.placing, u.name AS bringer
         FROM pizzas p LEFT JOIN users u ON u.id = p.bringer_id
        WHERE p.arrived_at IS NOT NULL ORDER BY p.box`
    ),
    env.DB.prepare(
      `SELECT t.user_id, u.name, t.pizza_id, t.position, t.score, t.note
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
    scores.push({ v: voterIndex.get(r.user_id), p: r.pizza_id, pos: r.position, s: r.score, note: r.note });
  }

  const config = Object.fromEntries(settings.results.map((s) => [s.key, s.value]));
  return {
    officialMethod: config.official_method || "",
    you: voterIndex.get(viewerId) ?? null,
    pizzas: pizzas.results.map(({ bringer, champion, ...p }) => ({
      ...p,
      champion: !!champion,
      ...(includeBringer ? { bringer } : {}),
    })),
    voters,
    scores,
  };
}
