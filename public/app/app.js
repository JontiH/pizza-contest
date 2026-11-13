import { CATEGORY_LABELS, METHODS } from "/assets/tally.js";
import { $, $$, ApiError, api, esc, fmt, medal, toast } from "/assets/ui.js";
import { askLocation, attachPlaceSearch, drawMap, locationFields } from "/app/places.js";

const view = $("#view");
const foot = $("#foot");
let me = null;
let tab = location.hash.slice(1) || "lineup";
let loginEmail = "";

const PHASES = [
  { key: "signup", label: "Sign-up", blurb: "People add pizzas. No tasting yet." },
  { key: "tasting", label: "Tasting open", blurb: "Checked-in guests get slices and score them." },
  { key: "closed", label: "Voting closed", blurb: "Scores locked. Guests can see results; run the count." },
  { key: "revealed", label: "Public", blurb: "Results page is open to everyone." },
];

const fail = (e) => toast(e.message);

async function init() {
  try {
    me = await api("GET", "/api/me");
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return renderLogin();
    view.innerHTML = `<p class="error">${esc(e.message)}</p>`;
    return;
  }
  foot.innerHTML = `Logged in as ${esc(me.email)} · <button class="link" data-act="logout">Log out</button>`;
  if (!me.registered) return renderRegister();
  if (me.status === "pending") return renderPending();
  if (me.status === "rejected") {
    view.innerHTML = `<div class="card login"><h2>Not approved</h2><p>The host didn't approve this account. If that's a mistake, ask them.</p></div>`;
    return;
  }
  renderMain();
}

// ---------- login ----------

function renderLogin(step = "email") {
  foot.innerHTML = "";
  if (step === "email") {
    view.innerHTML = `
      <form class="card login stack" data-form="login-email">
        <h2>Log in</h2>
        <p class="hint">We'll email you a 6-digit code. Your email is never shown to anyone else.</p>
        <input name="email" type="email" required autocomplete="email" placeholder="you@example.com" value="${esc(loginEmail)}">
        <button>Email me a code</button>
      </form>`;
  } else {
    view.innerHTML = `
      <form class="card login stack" data-form="login-code">
        <h2>Check your email</h2>
        <p class="hint">We sent a code to <strong>${esc(loginEmail)}</strong>. It expires in 10 minutes. Not there after a minute? Check your spam folder.</p>
        <input name="code" class="code-input" required inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000">
        <button>Log in</button>
        <button type="button" class="link" data-act="login-back">Use a different email</button>
      </form>`;
  }
  $("input", view).focus();
}

function renderRegister() {
  view.innerHTML = `
    <form class="card login stack" data-form="register">
      <h2>Pick a display name</h2>
      <p class="hint">Everyone sees this name next to your scores, and after the party it's on the public results page. Your email stays private.</p>
      <input name="name" required maxlength="30" autocomplete="nickname" placeholder="e.g. Mike">
      <button>Join</button>
    </form>`;
  $("input", view).focus();
}

function renderPending() {
  view.innerHTML = `
    <div class="card login">
      <h2>Almost in, ${esc(me.name)}</h2>
      <p>The host needs to approve you before you can sign up a pizza or vote. This page will update once they do.</p>
    </div>`;
  setTimeout(init, 15000);
}

// ---------- main ----------

function renderMain() {
  // Vote and Results stay visible but greyed out until the host opens them.
  const tabs = [
    ["lineup", "Lineup", true],
    ["info", "Info", true],
    ["vote", "Vote", me.phase !== "signup"],
    ["results", "Results", ["closed", "revealed"].includes(me.phase)],
    ...(me.admin ? [["admin", "Admin", true]] : []),
  ];
  if (!tabs.some(([k, , on]) => k === tab && on)) tab = "lineup";
  view.innerHTML = `
    <nav class="tabs">${tabs
      .map(
        ([k, l, on]) =>
          `<button data-tab="${k}" class="${k === tab ? "active" : ""}" ${on ? "" : `disabled title="Opens at the party"`}>${l}</button>`
      )
      .join("")}</nav>
    <section id="pane"><p class="empty">Loading…</p></section>`;
  loadTab();
}

let pollTimer = null;
async function loadTab() {
  clearTimeout(pollTimer);
  location.hash = tab;
  try {
    if (tab === "lineup") await renderLineup();
    if (tab === "info") await renderInfo();
    if (tab === "vote") await renderTaste();
    if (tab === "results") renderResultsLinks();
    if (tab === "admin") await renderAdmin();
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return init();
    $("#pane").innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}

const mapsUrl = (p) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.restaurant} ${p.address || ""} Toronto`)}`;
const mapLink = (p) => `<a class="map-link" href="${mapsUrl(p)}" target="_blank" rel="noopener noreferrer">Map</a>`;

const ORDINAL = { 1: "1st", 2: "2nd", 3: "3rd" };
const champBadge = (p) => (p.champion ? (p.placing ? medal("v1", p.placing) : `<span class="badge champ">🏆 v1</span>`) : "");
const pizzaName = (p) => (p.kind ? esc(p.kind) : p.category === "platonic" ? "Cheese" : "??");
let editingPick = false;
let editingChamp = null;

// Shown to people who haven't picked anything yet.
function championCard(board) {
  const unclaimed = board.pizzas.filter((p) => p.champion && !p.bringer).sort((a, b) => (a.placing || 9) - (b.placing || 9));
  if (!unclaimed.length) return "";
  return `
    <section class="card champs">
      <h3>Not sure what to bring?</h3>
      <p class="hint">Last contest's top pizzas need someone to bring them back.</p>
      <ul class="cards">${unclaimed
        .map(
          (p) => `<li class="row champ-row">
            <span class="grow">${champBadge(p)} <strong>${esc(p.restaurant)}</strong>${p.kind ? ` · ${esc(p.kind)}` : ""} ${mapLink(p)}</span>
            <button class="small" data-act="claim" data-id="${p.id}">I'll bring it</button>
          </li>`
        )
        .join("")}</ul>
    </section>`;
}

function pizzaLine(p) {
  return `${p.box ? `<span class="badge box">#${p.box}</span> ` : ""}<strong>${esc(p.restaurant)}</strong>${p.kind ? ` · ${esc(p.kind)}` : ""}`;
}

function pickForm(own, editing) {
  return `<form class="card stack" data-form="pizza" data-id="${own?.id || ""}" data-restaurant="${esc(own?.restaurant)}">
    <h2 style="margin-top:0">${own ? "Edit your pizza" : "What are you bringing?"}</h2>
    <label class="field">Restaurant
      <input name="restaurant" required maxlength="60" placeholder="Start typing to search" value="${esc(own?.restaurant)}">
    </label>
    <input type="hidden" name="lat"><input type="hidden" name="lon"><input type="hidden" name="address">
    <label class="field">Pizza type <span class="hint" data-kind-hint>(required for non-platonic)</span>
      <input name="kind" maxlength="60" placeholder="e.g. Pepperoni, Vodka. Leave blank for plain cheese" value="${esc(own?.kind)}" ${own?.category === "non_platonic" ? "required" : ""}>
    </label>
    <label class="field">Extra notes <span class="hint">(optional)</span>
      <input name="notes" maxlength="140" value="${esc(own?.notes)}">
    </label>
    <fieldset>
      ${Object.entries(CATEGORY_LABELS)
        .map(([k, l]) => `<label><input type="radio" name="category" value="${k}" required ${own?.category === k ? "checked" : ""}> ${l}</label>`)
        .join("")}
    </fieldset>
    <div class="row">
      <button>${own ? "Save" : "Add to the lineup"}</button>
      ${editing ? `<button type="button" class="secondary" data-act="cancel-edit">Cancel</button>` : ""}
      ${own && !own.arrived ? `<button type="button" class="link" data-act="remove-pizza" data-id="${own.id}">Remove my pizza</button>` : ""}
    </div>
  </form>`;
}

function myPicks(mine) {
  return `<section class="card mine">
    <h3>You're bringing</h3>
    <ul class="cards">${mine
      .map(
        (p) => `<li class="row">
          <span class="grow">${champBadge(p)} <strong>${esc(p.restaurant)}</strong> · ${pizzaName(p)}${p.notes ? `<br><span class="hint">${esc(p.notes)}</span>` : ""}</span>
          ${
            p.champion
              ? `<button class="small secondary" data-act="edit-champ" data-id="${p.id}">Edit</button>
                 <button class="small link" data-act="unclaim" data-id="${p.id}">Unclaim</button>`
              : `<button class="small secondary" data-act="edit-pick">Edit</button>`
          }
        </li>
        ${
          editingChamp === p.id
            ? `<li><form class="stack" data-form="champ" data-id="${p.id}">
                <label class="field">Pizza type<input name="kind" maxlength="60" placeholder="${p.category === "platonic" ? "Cheese" : "e.g. Pepperoni"}" value="${esc(p.kind)}"></label>
                <label class="field">Extra notes <span class="hint">(optional)</span><input name="notes" maxlength="140" value="${esc(p.notes)}"></label>
                <div class="row"><button>Save</button><button type="button" class="secondary" data-act="cancel-edit">Cancel</button></div>
              </form></li>`
            : ""
        }`
      )
      .join("")}</ul>
  </section>`;
}

function lineupTable(board, cat, open) {
  const rows = board.pizzas
    .filter((p) => p.category === cat)
    .sort((a, b) => b.champion - a.champion || (a.placing || 9) - (b.placing || 9) || a.id - b.id);
  const body = rows.length
    ? rows
        .map(
          (p) => `<tr class="${p.mine ? "is-mine" : ""}">
            <td>
              <strong>${esc(p.restaurant)}</strong> ${champBadge(p)}
              ${p.box ? `<span class="badge box">#${p.box}</span>` : ""}
              ${p.finished ? `<span class="badge done">finished</span>` : p.arrived ? `<span class="badge">on the table</span>` : ""}
              <br>${mapLink(p)}
            </td>
            <td><strong>${pizzaName(p)}</strong>${p.notes ? `<br><span class="hint">${esc(p.notes)}</span>` : ""}</td>
            <td>${
              p.bringer
                ? esc(p.bringer)
                : open && p.champion
                  ? `<button class="small" data-act="claim" data-id="${p.id}">I'll bring it</button>`
                  : `<span class="hint">nobody yet</span>`
            }</td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="3" class="empty">Nobody yet.</td></tr>`;
  return `
    <h3 class="cat">${CATEGORY_LABELS[cat]} <span class="hint">${cat === "platonic" ? "plain cheese" : "anything goes"} · ${rows.length}</span></h3>
    <table class="lineup">
      <thead><tr><th>Restaurant</th><th>Pizza type</th><th>Brought by</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

async function renderLineup() {
  const board = await api("GET", "/api/board");
  me.phase = board.phase;
  const open = ["signup", "tasting"].includes(board.phase);
  const mine = board.pizzas.filter((p) => p.mine);
  const own = mine.find((p) => !p.champion);
  const showForm = open && (!mine.length || editingPick);

  $("#pane").innerHTML = `
    ${showForm ? pickForm(own, editingPick) : ""}
    ${!showForm && mine.length ? myPicks(mine) : ""}
    ${open && !mine.length ? championCard(board) : ""}
    ${!open ? `<p class="hint">The lineup is locked.</p>` : ""}

    <h2>Who's bringing what</h2>
    ${lineupTable(board, "platonic", open)}
    ${lineupTable(board, "non_platonic", open)}

    <div id="map" class="pizza-map" hidden></div>

    <h2>Who's coming (${board.guests.length})</h2>
    <ul class="guests">${board.guests
      .map((g) => `<li class="badge">${esc(g.name)}${g.checked_in ? " ✓" : ""}${g.bringing ? " 🍕" : ""}</li>`)
      .join("")}</ul>
    <p class="hint">✓ checked in · 🍕 bringing a pizza</p>`;
  const form = $('form[data-form="pizza"]');
  if (form) attachPlaceSearch(form);
  drawMap($("#map"), board.pizzas).catch(() => ($("#map").hidden = true));
}

// A small, safe subset of Markdown for the FAQ: "## " headings, "- "
// bullets, **bold**, https links, blank lines between paragraphs. Text is
// escaped before any markup is added.
function miniMarkdown(src) {
  const inline = (t) =>
    esc(t)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  const out = [];
  let list = null;
  for (const raw of src.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("- ")) {
      if (!list) out.push((list = []));
      list.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }
    list = null;
    if (!line.trim()) continue;
    if (line.startsWith("## ")) out.push(`<h3>${inline(line.slice(3))}</h3>`);
    else out.push(`<p>${inline(line)}</p>`);
  }
  return out.map((x) => (Array.isArray(x) ? `<ul>${x.join("")}</ul>` : x)).join("");
}

async function renderInfo() {
  const i = await api("GET", "/api/info");
  const dest = [i.address, "Toronto"].filter(Boolean).join(", ");
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
  $("#pane").innerHTML = `
    <section class="card info-where">
      ${i.when ? `<h3>What day is this?</h3><p class="when-line">${esc(i.when)}</p>` : ""}
      <h3>Where does Jonti live?</h3>
      ${
        i.address
          ? `<p class="addr"><strong>${esc(i.address)}</strong>${i.unit ? `, ${esc(i.unit)}` : ""}</p>
             <ul class="info-notes">
               ${i.buzzer ? `<li>Buzzer code: <strong>${esc(i.buzzer)}</strong></li>` : ""}
               ${i.parking ? `<li>${esc(i.parking)}</li>` : ""}
             </ul>
             <div id="info-map" class="pizza-map" hidden></div>
             <a class="button" href="${directions}" target="_blank" rel="noopener noreferrer">Directions in Google Maps</a>`
          : `<p class="hint">The host hasn't added the address yet.</p>`
      }
    </section>
    <section class="faq">${miniMarkdown(i.body || "")}</section>`;
  const lat = Number(i.lat);
  const lon = Number(i.lon);
  if (i.lat && Number.isFinite(lat) && Number.isFinite(lon)) {
    drawMap($("#info-map"), [{ lat, lon, restaurant: i.address, kind: i.unit, bringer: "", champion: true, home: true }]).catch(() => {});
  }
}

async function renderTaste() {
  const t = await api("GET", "/api/tasting");
  me.phase = t.phase;
  const pane = $("#pane");
  const scoredList = (editable) =>
    t.scored.length
      ? `<h2>Your scores</h2>
         <ul class="cards scored-list">${t.scored
           .map(
             (s) => `<li class="card">
               <div class="row">
                 <span class="hint">${s.position}.</span>
                 <span class="grow">${pizzaLine(s)}</span>
                 ${
                   editable
                     ? `<input type="number" min="1" max="10" step="0.01" value="${s.score}" data-rescore="${s.pizza_id}" aria-label="Score">`
                     : `<strong>${fmt(s.score, 2)}</strong>`
                 }
               </div>
               ${
                 editable
                   ? `<input class="note-input" maxlength="280" placeholder="Notes" value="${esc(s.note)}" data-renote="${s.pizza_id}" aria-label="Notes">`
                   : s.note
                     ? `<p class="meta">“${esc(s.note)}”</p>`
                     : ""
               }
             </li>`
           )
           .join("")}</ul>`
      : "";

  if (t.phase === "signup") {
    pane.innerHTML = `<div class="card"><h2 style="margin-top:0">Tasting hasn't started</h2><p>At the party, the host checks you in and opens tasting. Then this page hands you one slice at a time.</p></div>`;
    return;
  }
  if (t.phase !== "tasting") {
    pane.innerHTML = `<div class="card"><h2 style="margin-top:0">Scoring is closed</h2><p>Results are in the Results tab.</p></div>${scoredList(false)}`;
    return;
  }
  if (!t.checkedIn) {
    pane.innerHTML = `<div class="card"><h2 style="margin-top:0">Find the host to check in</h2><p>Once you're checked in, you'll get your first slice here.</p></div>`;
    pollTimer = setTimeout(loadTab, 15000);
    return;
  }

  let main;
  if (t.current) {
    const c = t.current;
    main = `
      <form class="card slice-card" data-form="score" data-id="${c.pizza_id}">
        <div class="num">Your slice ${c.position}</div>
        <div class="boxnum">#${c.box}</div>
        <div class="rest">${esc(c.restaurant)}</div>
        <div class="hint">${esc(c.kind)}${c.kind ? " · " : ""}${CATEGORY_LABELS[c.category]}</div>
        <div class="score-picker">
          <input type="range" min="1" max="10" step="0.1" value="5.5" data-sync="range" aria-label="Score slider">
          <input type="number" class="big" name="score" min="1" max="10" step="0.01" required placeholder="–" data-sync="number" aria-label="Score">
          <textarea name="note" maxlength="280" rows="2" placeholder="Notes (optional)"></textarea>
        </div>
        <div class="stack">
          <button>Save score, next slice</button>
          ${t.allowSkip ? `<button type="button" class="secondary" data-act="skip">Skip this pizza for now</button>` : ""}
        </div>
      </form>`;
  } else if (t.left > 0) {
    main = `<div class="card slice-card"><p>${t.scored.length ? "Ready for more?" : "Ready when you are."}</p><button data-act="next">Give me a slice</button></div>`;
  } else {
    main = `<div class="card slice-card"><h2 style="margin-top:0">You've tried everything on the table</h2><p class="hint">More pizzas may still arrive. This checks automatically.</p><button class="secondary" data-act="refresh">Check now</button></div>`;
    pollTimer = setTimeout(loadTab, 20000);
  }
  pane.innerHTML = main + scoredList(true);
}

function renderResultsLinks() {
  $("#pane").innerHTML = `
    <div class="card stack">
      <h2 style="margin-top:0">Results</h2>
      <a class="button" href="/results/">Open the results explorer</a>
    </div>`;
}

// ---------- admin ----------

async function renderAdmin() {
  const a = await api("GET", "/api/admin");
  me.phase = a.settings.phase;
  const approved = a.users.filter((u) => u.status === "approved");
  const pending = a.users.filter((u) => u.status === "pending");
  const bringerSelect = (p) => `
    <select data-bringer="${p.id}">
      <option value="">nobody</option>
      ${approved.map((u) => `<option value="${u.id}" ${p.bringer_id === u.id ? "selected" : ""}>${esc(u.name)}</option>`).join("")}
    </select>`;

  $("#pane").innerHTML = `
    <h2>Phase</h2>
    <div class="phases">${PHASES.map(
      (p) => `<button data-phase="${p.key}" class="${a.settings.phase === p.key ? "current" : ""}">${p.label}<small>${p.blurb}</small></button>`
    ).join("")}</div>
    <div class="row" style="margin-top:0.8rem">
      <label for="method">Official method</label>
      <select id="method" data-act-change="method">
        <option value="">Decide later</option>
        ${METHODS.map((m) => `<option value="${m.key}" ${a.settings.official_method === m.key ? "selected" : ""}>${m.label}</option>`).join("")}
      </select>
    </div>
    <p class="row">
      <label><input type="checkbox" data-act-change="allow-skip" ${a.settings.allow_skip === "1" ? "checked" : ""}> Let voters skip a pizza for now</label>
    </p>
    <p class="row"><a href="/results/">Preview results (admin only)</a></p>

    <details class="card info-edit" ${a.settings.info_address ? "" : "open"}>
      <summary><strong>Edit info</strong> <span class="hint">(the Info tab, approved guests only)</span></summary>
      <form class="stack" data-form="info">
        <label class="field">When<input name="when" maxlength="120" value="${esc(a.settings.info_when)}"></label>
        <label class="field">Address<input name="address" maxlength="120" value="${esc(a.settings.info_address)}"></label>
        <label class="field">Unit<input name="unit" maxlength="40" value="${esc(a.settings.info_unit)}"></label>
        <label class="field">Buzzer code<input name="buzzer" maxlength="40" value="${esc(a.settings.info_buzzer)}"></label>
        <label class="field">Parking<input name="parking" maxlength="200" value="${esc(a.settings.info_parking)}"></label>
        <label class="field">More FAQ <span class="hint">(added after the built-in questions) "## " starts a heading, "- " a bullet, **bold**</span>
          <textarea name="body" rows="14" maxlength="5000">${esc(a.settings.info_body)}</textarea></label>
        <button>Save info</button>
      </form>
    </details>

    <h2>Waiting for approval (${pending.length})</h2>
    ${
      pending.length
        ? `<ul class="cards">${pending
            .map(
              (u) => `<li class="card row"><span class="grow"><strong>${esc(u.name)}</strong><br><span class="hint">${esc(u.email)}</span></span>
                <button class="small" data-user="${u.id}" data-status="approved">Approve</button>
                <button class="small secondary" data-user="${u.id}" data-status="rejected">Reject</button></li>`
            )
            .join("")}</ul>`
        : `<p class="hint">Nobody waiting.</p>`
    }

    <h2>Guests (${approved.length})</h2>
    <div class="scroll"><table class="admin-table">
      <tr><th>Name</th><th>Email</th><th>Here?</th><th>Scored</th><th></th></tr>
      ${a.users
        .filter((u) => u.status !== "pending")
        .map(
          (u) => `<tr>
            <td>${esc(u.name)}${u.status === "rejected" ? ` <span class="badge">rejected</span>` : ""}</td>
            <td class="hint">${esc(u.email)}</td>
            <td>${
              u.status === "approved"
                ? `<button class="small ${u.checked_in ? "on" : "secondary"}" data-checkin="${u.id}" data-value="${!u.checked_in}">${u.checked_in ? "Checked in" : "Check in"}</button>`
                : ""
            }</td>
            <td>${u.scored}</td>
            <td>${
              u.status === "rejected"
                ? `<button class="small secondary" data-user="${u.id}" data-status="approved">Approve</button>`
                : `<button class="small link" data-user="${u.id}" data-status="rejected">Remove</button>`
            }</td>
          </tr>`
        )
        .join("")}
    </table></div>
    <p class="hint">Checking someone in puts their pizza on the table and gives it the next box number.</p>

    <h2>Pizzas (${a.pizzas.length})</h2>
    <div class="scroll"><table class="admin-table">
      <tr><th>Box</th><th>Pizza</th><th>Brought by</th><th>Status</th><th></th></tr>
      ${a.pizzas
        .map(
          (p) => `<tr>
            <td>${p.box ? `<span class="badge box">#${p.box}</span>` : ""}</td>
            <td><strong>${esc(p.restaurant)}</strong>${p.kind ? ` · ${esc(p.kind)}` : ""}<br>
              <span class="hint">${CATEGORY_LABELS[p.category]}${p.champion ? ` · 🏆 v1${p.placing ? ` ${ORDINAL[p.placing]}` : ""}` : ""} · ${p.scored} scores</span><br>
              <span class="hint">${p.lat != null ? `📍 ${esc(p.address || "on the map")}` : "Not on the map"}</span>
              <button class="small link" data-fix-location="${p.id}" data-name="${esc(p.restaurant)}">${p.lat != null ? "Move pin" : "Add pin"}</button></td>
            <td>${bringerSelect(p)}</td>
            <td class="row">
              <button class="small ${p.arrived_at ? "on" : "secondary"}" data-pizza="${p.id}" data-field="arrived" data-value="${!p.arrived_at}">${p.arrived_at ? "On table" : "Arrived"}</button>
              ${p.arrived_at ? `<button class="small ${p.finished_at ? "on" : "secondary"}" data-pizza="${p.id}" data-field="finished" data-value="${!p.finished_at}">${p.finished_at ? "Finished" : "Finish"}</button>` : ""}
            </td>
            <td>${p.scored ? "" : `<button class="small link" data-delete-pizza="${p.id}">Delete</button>`}</td>
          </tr>`
        )
        .join("")}
    </table></div>

    <form class="card stack" data-form="admin-pizza" style="margin-top:1rem">
      <h3>Add a pizza</h3>
      <p class="hint">Add as many as you like, for anyone or for nobody yet. Tick "Returning champion" for a champion slot.</p>
      <input name="restaurant" required maxlength="60" placeholder="Restaurant (start typing to search)">
      <input type="hidden" name="lat"><input type="hidden" name="lon"><input type="hidden" name="address">
      <input name="kind" maxlength="60" placeholder="Pizza type, if known (blank = cheese)">
      <input name="notes" maxlength="140" placeholder="Extra notes (optional)">
      <fieldset>
        ${Object.entries(CATEGORY_LABELS).map(([k, l]) => `<label><input type="radio" name="category" value="${k}" required> ${l}</label>`).join("")}
        <label><input type="checkbox" name="champion"> Returning champion</label>
        <select name="placing" aria-label="Placing last time"><option value="">placing last time</option><option value="1">1st</option><option value="2">2nd</option><option value="3">3rd</option></select>
      </fieldset>
      <select name="bringer_id"><option value="">Brought by nobody yet</option>${approved
        .map((u) => `<option value="${u.id}">${esc(u.name)}</option>`)
        .join("")}</select>
      <button>Add</button>
    </form>`;
  attachPlaceSearch($('form[data-form="admin-pizza"]'));
}

// ---------- events ----------

view.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  let data = Object.fromEntries(new FormData(form));
  const button = $("button:not([type])", form) || $("button", form);
  const picksPlace = ["pizza", "admin-pizza"].includes(form.dataset.form);
  const renamed = form.dataset.form === "pizza" && form.dataset.id ? data.restaurant !== form.dataset.restaurant : true;
  if (picksPlace && renamed && !data.lat && data.restaurant.trim()) {
    if (button) button.disabled = true;
    const place = await askLocation(form, data.restaurant.trim());
    if (place) data = { ...data, restaurant: place.name, lat: place.lat, lon: place.lon, address: place.address };
  }
  if (button) button.disabled = true;
  try {
    switch (form.dataset.form) {
      case "login-email":
        loginEmail = data.email.trim();
        try {
          const sent = await api("POST", "/pub/login/start", { email: loginEmail });
          if (sent.devCode) {
            renderLogin("code");
            $("input[name=code]").value = sent.devCode;
            return toast("Local dev: code filled in for you");
          }
        } catch (err) {
          // A code from a minute ago is still good, so let them type it.
          if (!(err.status === 429 && err.message.includes("just sent"))) throw err;
          toast("We already sent you a code. Check your email.");
        }
        return renderLogin("code");
      case "login-code":
        await api("POST", "/pub/login/verify", { email: loginEmail, code: data.code });
        return init();
      case "register":
        await api("POST", "/api/me", { name: data.name });
        return init();
      case "pizza":
        if (form.dataset.id) await api("PATCH", `/api/pizzas/${form.dataset.id}`, locationFields(data));
        else await api("POST", "/api/pizzas", locationFields(data));
        editingPick = false;
        toast("Saved");
        return loadTab();
      case "info":
        await api("POST", "/api/admin/settings", { info: data });
        toast("Info saved");
        return loadTab();
      case "champ":
        await api("PATCH", `/api/pizzas/${form.dataset.id}`, { kind: data.kind, notes: data.notes });
        editingChamp = null;
        toast("Saved");
        return loadTab();
      case "score": {
        const pizzaId = Number(form.dataset.id);
        await api("PUT", "/api/tasting/score", { pizza_id: pizzaId, score: data.score, note: data.note || "" });
        await api("POST", "/api/tasting/next");
        return loadTab();
      }
      case "admin-pizza":
        await api("POST", "/api/admin/pizzas", { ...locationFields(data), champion: data.champion === "on", bringer_id: data.bringer_id || null });
        toast("Added");
        return loadTab();
    }
  } catch (err) {
    fail(err);
  } finally {
    if (button) button.disabled = false;
  }
});

view.addEventListener("click", async (e) => {
  const el = e.target.closest("button");
  if (!el || el.type === "submit" && el.form) return;
  const d = el.dataset;
  try {
    if (d.tab) {
      tab = d.tab;
      $$("nav.tabs button").forEach((b) => b.classList.toggle("active", b === el));
      return loadTab();
    }
    if (d.act === "login-back") return renderLogin("email");
    if (d.act === "edit-pick" || d.act === "cancel-edit" || d.act === "edit-champ") {
      editingPick = d.act === "edit-pick";
      editingChamp = d.act === "edit-champ" ? Number(d.id) : null;
      return loadTab();
    }
    if (d.act === "claim") await api("POST", `/api/pizzas/${d.id}/claim`);
    else if (d.act === "unclaim") await api("POST", `/api/pizzas/${d.id}/unclaim`);
    else if (d.act === "remove-pizza") {
      if (!confirm("Remove your pizza from the lineup?")) return;
      await api("DELETE", `/api/pizzas/${d.id}`);
    } else if (d.act === "next") await api("POST", "/api/tasting/next");
    else if (d.act === "skip") await api("POST", "/api/tasting/skip");
    else if (d.act === "refresh") {
      /* reload below */
    } else if (d.phase) {
      const label = PHASES.find((p) => p.key === d.phase).label;
      if (!confirm(`Switch to "${label}"?`)) return;
      await api("POST", "/api/admin/settings", { phase: d.phase });
      me.phase = d.phase;
      return renderMain();
    } else if (d.user) {
      await api("POST", `/api/admin/users/${d.user}`, { status: d.status });
    } else if (d.checkin) {
      await api("POST", `/api/admin/users/${d.checkin}`, { checked_in: d.value === "true" });
    } else if (d.pizza) {
      await api("POST", `/api/admin/pizzas/${d.pizza}`, { [d.field]: d.value === "true" });
    } else if (d.fixLocation) {
      const link = prompt(`Paste a Google Maps link for ${d.name}:`);
      if (!link) return;
      await api("POST", `/api/admin/pizzas/${d.fixLocation}`, { maps_link: link });
      toast("Pin updated");
    } else if (d.deletePizza) {
      if (!confirm("Delete this pizza?")) return;
      await api("DELETE", `/api/admin/pizzas/${d.deletePizza}`);
    } else return;
    await loadTab();
  } catch (err) {
    fail(err);
  }
});

view.addEventListener("change", (e) => {
  if (e.target.name !== "category" || !e.target.form || e.target.form.dataset.form !== "pizza") return;
  e.target.form.querySelector("input[name=kind]").required = e.target.value === "non_platonic";
});

view.addEventListener("input", (e) => {
  const sync = e.target.dataset.sync;
  if (!sync) return;
  const form = e.target.form;
  const other = $(`[data-sync="${sync === "range" ? "number" : "range"}"]`, form);
  other.value = e.target.value;
});

view.addEventListener("change", async (e) => {
  const el = e.target;
  try {
    if (el.dataset.renote) {
      await api("PUT", "/api/tasting/score", { pizza_id: Number(el.dataset.renote), note: el.value });
      toast("Note saved");
    } else if (el.dataset.rescore) {
      await api("PUT", "/api/tasting/score", { pizza_id: Number(el.dataset.rescore), score: el.value });
      toast("Score updated");
    } else if (el.dataset.bringer) {
      await api("POST", `/api/admin/pizzas/${el.dataset.bringer}`, { bringer_id: el.value || null });
      toast("Saved");
    } else if (el.dataset.actChange === "allow-skip") {
      await api("POST", "/api/admin/settings", { allow_skip: el.checked });
      toast(el.checked ? "Voters can skip a pizza" : "Skipping turned off");
    } else if (el.dataset.actChange === "method") {
      await api("POST", "/api/admin/settings", { official_method: el.value });
      toast("Official method saved");
    }
  } catch (err) {
    fail(err);
    loadTab();
  }
});

foot.addEventListener("click", async (e) => {
  if (e.target.dataset.act !== "logout") return;
  await api("POST", "/api/logout").catch(() => {});
  me = null;
  init();
});

init();
