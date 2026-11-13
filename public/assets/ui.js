export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function toast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 2600);
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined || method !== "GET" ? { "content-type": "application/json" } : {},
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `request failed (${res.status})`);
  return data;
}

export const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : "–");
export const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

// Medal label for a contest placing: gold, silver, bronze fill; the
// outline says which contest (v1 blue, v2 red).
const PLACE = { 1: "1st", 2: "2nd", 3: "3rd" };
export function medal(version, place) {
  if (!PLACE[place]) return "";
  return `<span class="badge place place-${place} ${version}">${version} · ${PLACE[place]}</span>`;
}
