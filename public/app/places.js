import { api, esc } from "/assets/ui.js";

// Suggestions under a restaurant box. Picking one fills the hidden
// lat/lon/address fields; typing again clears them so the server falls back
// to its own lookup.
export function attachPlaceSearch(form) {
  const input = form.querySelector("input[name=restaurant]");
  const fields = ["lat", "lon", "address"].map((n) => form.querySelector(`input[name=${n}]`));
  const list = document.createElement("ul");
  list.className = "suggest";
  list.hidden = true;
  input.after(list);
  let timer = null;
  let seq = 0;

  const clear = () => fields.forEach((f) => (f.value = ""));
  const close = () => (list.hidden = true);

  input.setAttribute("autocomplete", "off");
  input.addEventListener("input", () => {
    clear();
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) return close();
    // Wait for a pause in typing so the free OpenStreetMap search isn't
    // hit on every keystroke.
    timer = setTimeout(async () => {
      const mine = ++seq;
      try {
        const { results } = await api("GET", `/api/places?q=${encodeURIComponent(q)}`);
        if (mine !== seq) return;
        const shown = results.filter((r) => r.food).length ? results.filter((r) => r.food) : results;
        if (!shown.length) return close();
        list.innerHTML = shown
          .map(
            (r, i) => `<li><button type="button" data-i="${i}"><strong>${esc(r.name)}</strong><span>${esc(r.address)}</span></button></li>`
          )
          .join("");
        list.onclick = (e) => {
          const b = e.target.closest("button[data-i]");
          if (!b) return;
          const r = shown[Number(b.dataset.i)];
          input.value = r.name;
          fields[0].value = r.lat;
          fields[1].value = r.lon;
          fields[2].value = r.address;
          close();
        };
        list.hidden = false;
      } catch {
        close();
      }
    }, 350);
  });
  input.addEventListener("keydown", (e) => e.key === "Escape" && close());
  input.addEventListener("blur", () => setTimeout(close, 200));
}

// Empty hidden fields mean "not picked"; drop them so the server looks the
// place up instead of rejecting blank coordinates.
export function locationFields(data) {
  const out = { ...data };
  if (!out.lat || !out.lon) {
    delete out.lat;
    delete out.lon;
    delete out.address;
  }
  return out;
}

let leaflet = null;
function loadLeaflet() {
  if (!leaflet) {
    leaflet = new Promise((resolve, reject) => {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "/assets/vendor/leaflet/leaflet.css";
      document.head.append(css);
      const js = document.createElement("script");
      js.src = "/assets/vendor/leaflet/leaflet.js";
      js.onload = () => resolve(window.L);
      js.onerror = reject;
      document.head.append(js);
    });
  }
  return leaflet;
}

export async function drawMap(el, pizzas) {
  const pins = pizzas.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (!pins.length) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const L = await loadLeaflet();
  const map = L.map(el, { scrollWheelZoom: false });
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  const bounds = [];
  for (const p of pins) {
    const icon = L.divIcon({ className: `pin${p.champion ? " champ" : ""}`, html: "<span>🍕</span>", iconSize: [30, 30], iconAnchor: [15, 15] });
    L.marker([p.lat, p.lon], { icon })
      .addTo(map)
      .bindPopup(
        `<strong>${esc(p.restaurant)}</strong>${p.champion ? " 🏆" : ""}<br>${esc(p.kind)}${p.kind ? "<br>" : ""}` +
          `<span class="hint">${p.bringer ? `Brought by ${esc(p.bringer)}` : "Needs a volunteer"}</span>`
      );
    bounds.push([p.lat, p.lon]);
  }
  if (bounds.length === 1) map.setView(bounds[0], 14);
  else map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
}
