export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const bad = (message) => new HttpError(400, message);

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

export async function readJson(request) {
  // Requiring JSON makes any cross-site write a CORS preflight, which this
  // API never approves. SameSite=Lax on the session cookie covers the rest.
  if (!(request.headers.get("content-type") || "").startsWith("application/json")) {
    throw new HttpError(415, "send JSON");
  }
  try {
    return await request.json();
  } catch {
    throw bad("body must be JSON");
  }
}

export function text(value, field, max, required = false) {
  const s = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (required && !s) throw bad(`${field} is required`);
  if (s.length > max) throw bad(`${field} must be at most ${max} characters`);
  return s;
}

export async function handle(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "something went wrong" }, 500);
  }
}
