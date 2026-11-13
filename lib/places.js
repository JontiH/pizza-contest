import { bad } from "./http.js";

// Place search through Photon (komoot's OpenStreetMap geocoder, built for
// search-as-you-type). Results are limited to Toronto and cached in D1.
const PHOTON = "https://photon.komoot.io/api/";
const TORONTO = { lat: 43.6532, lon: -79.3832, bbox: "-79.64,43.58,-79.11,43.86" };
const CACHE_S = 30 * 24 * 3600;
const FOOD = new Set(["restaurant", "fast_food", "cafe", "bar", "pub", "food_court"]);
const now = () => Math.floor(Date.now() / 1000);

// Photon's "district" is the electoral riding, which reads oddly, so this
// is the street address, or the neighbourhood when there's no street.
function address(p) {
  return [p.housenumber, p.street].filter(Boolean).join(" ") || p.locality || "";
}

export async function searchPlaces(env, query) {
  const q = typeof query === "string" ? query.trim().replace(/\s+/g, " ").toLowerCase() : "";
  if (q.length < 3 || q.length > 60) return [];

  const hit = await env.DB.prepare(`SELECT results, fetched_at FROM place_cache WHERE query = ?`).bind(q).first();
  if (hit && now() - hit.fetched_at < CACHE_S) return JSON.parse(hit.results);

  const url = `${PHOTON}?q=${encodeURIComponent(q)}&lat=${TORONTO.lat}&lon=${TORONTO.lon}&bbox=${TORONTO.bbox}&limit=8&lang=en`;
  const res = await fetch(url, { headers: { "user-agent": "pizzacontest.ca (party site)" } });
  if (!res.ok) throw bad("place search is unavailable right now");
  const data = await res.json();

  const results = data.features
    .filter((f) => f.properties.name)
    .map((f) => ({
      name: f.properties.name,
      address: address(f.properties),
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
      food: FOOD.has(f.properties.osm_value),
    }))
    // Restaurants first; Photon's own ranking is kept within each group.
    .sort((a, b) => b.food - a.food)
    .slice(0, 6);

  await env.DB.prepare(
    `INSERT INTO place_cache (query, results, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT (query) DO UPDATE SET results = excluded.results, fetched_at = excluded.fetched_at`
  )
    .bind(q, JSON.stringify(results), now())
    .run();
  return results;
}

// Best guess for a restaurant name, used when someone saves without picking
// a suggestion. Only food places count; otherwise the pizza has no pin.
export async function guessPlace(env, name) {
  try {
    const results = await searchPlaces(env, name);
    return results.find((r) => r.food) || null;
  } catch {
    return null;
  }
}

const inToronto = (lat, lon) => lat > 43.3 && lat < 44.2 && lon > -80.2 && lon < -78.8;

export function parseLocation(body) {
  if (body.lat === undefined && body.lon === undefined) return null;
  if (body.lat === null) return { lat: null, lon: null, address: "" };
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inToronto(lat, lon)) throw bad("that location isn't in Toronto");
  const addr = typeof body.address === "string" ? body.address.trim().slice(0, 120) : "";
  return { lat, lon, address: addr };
}

// Reads coordinates out of a Google Maps link. Short share links
// (maps.app.goo.gl) are followed one redirect to the full URL.
export async function locationFromMapsLink(link) {
  let url;
  try {
    url = new URL(link.trim());
  } catch {
    throw bad("paste a Google Maps link");
  }
  const short = ["maps.app.goo.gl", "goo.gl"].includes(url.hostname);
  const google = /(^|\.)google\.[a-z.]+$/.test(url.hostname);
  if (!short && !google) throw bad("paste a Google Maps link");
  if (short) {
    const res = await fetch(url, { redirect: "manual" });
    const next = res.headers.get("location");
    if (!next) throw bad("couldn't open that link");
    url = new URL(next);
    if (!/(^|\.)google\.[a-z.]+$/.test(url.hostname)) throw bad("couldn't open that link");
  }
  const s = decodeURIComponent(url.href);
  const m = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || s.match(/[?&](?:q|query|ll)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  if (!m) throw bad("couldn't find a location in that link");
  return parseLocation({ lat: m[1], lon: m[2], address: "" });
}
