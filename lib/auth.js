import { HttpError, bad, json } from "./http.js";

const CODE_TTL_S = 10 * 60;
const CODE_MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_S = 60;
const SESSION_TTL_S = 30 * 24 * 3600;
const DAILY_EMAIL_CAP = 90;
// Guests at the party share one IP on the WiFi, so this stays well above the guest count.
const DAILY_EMAIL_CAP_PER_IP = 40;
const COOKIE = "pizza_session";

const now = () => Math.floor(Date.now() / 1000);
const today = () => new Date().toISOString().slice(0, 10);

async function sha256(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomCode() {
  // Rejection sampling keeps all six-digit codes equally likely.
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] >= 4294000000);
  return String(buf[0] % 1000000).padStart(6, "0");
}

export function normalizeEmail(value) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad("enter a valid email");
  return email;
}

function isLocal(request) {
  const host = new URL(request.url).hostname;
  return host === "localhost" || host === "127.0.0.1";
}

async function bumpCounter(env, key, cap) {
  const count = await env.DB.prepare(
    `INSERT INTO email_sends (key, count) VALUES (?, 1)
     ON CONFLICT (key) DO UPDATE SET count = count + 1 RETURNING count`
  )
    .bind(key)
    .first("count");
  return count <= cap;
}

export async function startLogin(request, env, email) {
  const existing = await env.DB.prepare(`SELECT sent_at FROM login_codes WHERE email = ?`).bind(email).first();
  if (existing && now() - existing.sent_at < RESEND_COOLDOWN_S) {
    throw new HttpError(429, "a code was just sent; wait a minute before asking again");
  }

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (!(await bumpCounter(env, `ip:${ip}:${today()}`, DAILY_EMAIL_CAP_PER_IP))) {
    throw new HttpError(429, "too many codes requested today; try tomorrow");
  }
  if (!(await bumpCounter(env, `day:${today()}`, DAILY_EMAIL_CAP))) {
    throw new HttpError(429, "the site has sent all its login emails for today; try tomorrow");
  }

  const code = randomCode();
  await env.DB.prepare(
    `INSERT INTO login_codes (email, code_hash, expires_at, attempts, sent_at) VALUES (?, ?, ?, 0, ?)
     ON CONFLICT (email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at,
       attempts = 0, sent_at = excluded.sent_at`
  )
    .bind(email, await sha256(`${email}:${code}`), now() + CODE_TTL_S, now())
    .run();

  if (!env.RESEND_API_KEY) {
    if (!isLocal(request)) throw new HttpError(500, "email sending is not set up");
    console.log(`[dev] login code for ${email}: ${code}`);
    return { devCode: code };
  }

  await sendEmail(env, [email], `Your Pizza Contest code: ${code}`,
    `Your login code is ${code}. It expires in 10 minutes.\n\nIf you didn't ask for this, ignore this email.`);
}

export async function sendEmail(env, to, subject, text) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_FROM || "Pizza Contest <login@pizzacontest.ca>", to, subject, text }),
  });
  if (!res.ok) {
    console.error("resend failed", res.status, await res.text());
    throw new HttpError(502, "couldn't send the email; try again in a minute");
  }
}

// Emails the admins about a new sign-up. Never fails the sign-up itself.
export async function notifyAdmins(env, request, name, email) {
  const admins = (env.ADMIN_EMAILS || "").split(",").map((e) => e.trim()).filter(Boolean);
  if (!admins.length) return;
  const subject = `Pizza Contest: ${name} wants in`;
  const text = `${name} (${email}) signed up and is waiting for approval.\n\nApprove them here: ${new URL(request.url).origin}/app/#admin`;
  try {
    if (!env.RESEND_API_KEY) {
      if (isLocal(request)) console.log(`[dev] email to ${admins.join(", ")}: ${subject} | ${text}`);
      return;
    }
    if (!(await bumpCounter(env, `day:${today()}`, DAILY_EMAIL_CAP))) return;
    await sendEmail(env, admins, subject, text);
  } catch (e) {
    console.error("admin notification failed", e);
  }
}

export async function verifyLogin(request, env, email, code) {
  const row = await env.DB.prepare(`SELECT * FROM login_codes WHERE email = ?`).bind(email).first();
  if (!row || row.expires_at < now()) throw bad("that code has expired; ask for a new one");
  if (row.attempts >= CODE_MAX_ATTEMPTS) throw bad("too many wrong tries; ask for a new code");
  await env.DB.prepare(`UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?`).bind(email).run();

  const clean = typeof code === "string" ? code.replace(/\D/g, "") : "";
  if ((await sha256(`${email}:${clean}`)) !== row.code_hash) throw bad("wrong code");

  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM login_codes WHERE email = ?`).bind(email),
    env.DB.prepare(`DELETE FROM sessions WHERE expires_at < ?`).bind(now()),
    env.DB.prepare(`INSERT INTO sessions (token_hash, email, expires_at) VALUES (?, ?, ?)`).bind(
      await sha256(token),
      email,
      now() + SESSION_TTL_S
    ),
  ]);
  return json({ ok: true }, 200, {
    "set-cookie": `${COOKIE}=${token}; Path=/; HttpOnly;${secure(request)} SameSite=Lax; Max-Age=${SESSION_TTL_S}`,
  });
}

// Production is always HTTPS; plain-HTTP localhost dev needs the cookie
// without Secure so non-browser test clients send it back.
const secure = (request) => (new URL(request.url).protocol === "https:" ? " Secure;" : "");

function sessionToken(request) {
  const cookie = request.headers.get("cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return match ? match[1] : null;
}

export async function sessionEmail(request, env) {
  const token = sessionToken(request);
  if (!token) return null;
  const row = await env.DB.prepare(`SELECT email, expires_at FROM sessions WHERE token_hash = ?`)
    .bind(await sha256(token))
    .first();
  return row && row.expires_at > now() ? row.email : null;
}

export async function logout(request, env) {
  const token = sessionToken(request);
  if (token) await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(await sha256(token)).run();
  return json({ ok: true }, 200, { "set-cookie": `${COOKIE}=; Path=/; HttpOnly;${secure(request)} SameSite=Lax; Max-Age=0` });
}

export function isAdmin(env, email) {
  return (env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email);
}
