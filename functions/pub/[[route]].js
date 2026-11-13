import { normalizeEmail, startLogin, verifyLogin } from "../../lib/auth.js";
import { HttpError, handle, json, readJson } from "../../lib/http.js";
import { buildResults } from "../../lib/results.js";

// Everything under /pub works without logging in, so it must never return
// names, emails or the lineup before the admin reveals the results.
export function onRequest({ request, env, params }) {
  return handle(async () => {
    const path = (params.route || []).join("/");
    const method = request.method;

    if (method === "POST" && path === "login/start") {
      const body = await readJson(request);
      const sent = await startLogin(request, env, normalizeEmail(body.email));
      return json({ ok: true, ...sent });
    }
    if (method === "POST" && path === "login/verify") {
      const body = await readJson(request);
      return verifyLogin(request, env, normalizeEmail(body.email), body.code);
    }

    const phase = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'phase'`).first("value");
    if (method === "GET" && path === "info") return json({ revealed: phase === "revealed" });
    if (method === "GET" && path === "results") {
      if (phase !== "revealed") throw new HttpError(404, "results aren't public yet");
      return json(await buildResults(env, { includeBringer: false }));
    }
    throw new HttpError(404, "not found");
  });
}
