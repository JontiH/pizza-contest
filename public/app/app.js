import { CATEGORY_LABELS, METHODS } from "/assets/tally.js";
import { $, $$, ApiError, api, esc, fmt, toast } from "/assets/ui.js";

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
        <p class="hint">We sent a code to <strong>${esc(loginEmail)}</strong>. It expires in 10 minutes.</p>
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
  const tabs = [
    ["lineup", "Lineup"],
    ["taste", "Taste"],
    ...(["closed", "revealed"].includes(me.phase) ? [["results", "Results"]] : []),
    ...(me.admin ? [["admin", "Admin"]] : []),
  ];
  if (!tabs.some(([k]) => k === tab)) tab = "lineup";
  view.innerHTML = `
    <nav class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? "active" : ""}">${l}</button>`).join("")}</nav>
    <section id="pane"><p class="empty">Loading…</p></section>`;
  loadTab();
}

let pollTimer = null;
async function loadTab() {
  clearTimeout(pollTimer);
  location.hash = tab;
  try {
    if (tab === "lineup") await renderLineup();
    if (tab === "taste") await renderTaste();
    if (tab === "results") renderResultsLinks();
    if (tab === "admin") await renderAdmin();
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return init();
    $("#pane").innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}

function pizzaLine(p) {
  return `${p.box ? `<span class="badge box">#${p.box}</span> ` : ""}<strong>${esc(p.restaurant)}</strong>${p.kind ? ` · ${esc(p.kind)}` : ""}`;
}

async function renderLineup() {
  const board = await api("GET", "/api/board");
  me.phase = board.phase;
  const open = ["signup", "tasting"].includes(board.phase);
  const own = board.pizzas.find((p) => p.mine && !p.champion);

  const section = (cat) => {
    const list = board.pizzas.filter((p) => p.category === cat);
    return `
      <h2>${CATEGORY_LABELS[cat]} <span class="hint">${cat === "platonic" ? "plain cheese" : "anything goes"}</span></h2>
      <ul class="cards">${
        list.length
          ? list
              .map(
                (p) => `<li class="card">
                  <div class="row">
                    <div class="grow">
                      ${pizzaLine(p)}
                      ${p.champion ? ` <span class="badge champ">🏆 returning champion</span>` : ""}
                      ${p.finished ? ` <span class="badge done">finished</span>` : p.arrived ? ` <span class="badge">on the table</span>` : ""}
                      <p class="meta">${p.bringer ? `Brought by ${esc(p.bringer)}` : "Needs a volunteer"}</p>
                    </div>
                    ${
                      open && p.champion && !p.bringer
                        ? `<button class="small" data-act="claim" data-id="${p.id}">I'll bring it</button>`
                        : open && p.champion && p.mine
                          ? `<button class="small secondary" data-act="unclaim" data-id="${p.id}">Unclaim</button>`
                          : ""
                    }
                  </div>
                </li>`
              )
              .join("")
          : `<li class="empty">Nobody yet.</li>`
      }</ul>`;
  };

  $("#pane").innerHTML = `
    ${
      open
        ? `<form class="card stack" data-form="pizza" data-id="${own?.id || ""}">
            <h2 style="margin-top:0">${own ? "Your pizza" : "What are you bringing?"}</h2>
            <input name="restaurant" required maxlength="60" placeholder="Restaurant" value="${esc(own?.restaurant)}">
            <input name="kind" maxlength="80" placeholder="What pizza (e.g. Margherita, Pepperoni)" value="${esc(own?.kind)}">
            <fieldset>
              ${Object.entries(CATEGORY_LABELS)
                .map(
                  ([k, l]) =>
                    `<label><input type="radio" name="category" value="${k}" required ${own?.category === k ? "checked" : ""}> ${l}</label>`
                )
                .join("")}
            </fieldset>
            <div class="row">
              <button>${own ? "Save" : "Add to the lineup"}</button>
              ${own && !own.arrived ? `<button type="button" class="secondary" data-act="remove-pizza" data-id="${own.id}">Remove</button>` : ""}
            </div>
          </form>`
        : `<p class="hint">The lineup is locked.</p>`
    }
    ${section("platonic")}
    ${section("non_platonic")}
    <h2>Who's coming (${board.guests.length})</h2>
    <ul class="guests">${board.guests
      .map((g) => `<li class="badge">${esc(g.name)}${g.checked_in ? " ✓" : ""}${g.bringing ? " 🍕" : ""}</li>`)
      .join("")}</ul>
    <p class="hint">✓ checked in · 🍕 bringing a pizza</p>`;
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
               <span class="hint">${s.position}.</span>
               <span class="grow">${pizzaLine(s)}</span>
               ${
                 editable
                   ? `<input type="number" min="1" max="10" step="0.01" value="${s.score}" data-rescore="${s.pizza_id}" aria-label="Score">`
                   : `<strong>${fmt(s.score, 2)}</strong>`
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
        </div>
        <div class="stack">
          <button>Save score, next slice</button>
          <button type="button" class="secondary" data-act="skip">I can't get to box #${c.box} right now</button>
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
      ${me.admin ? `<a class="button secondary" href="/app/count.html">Election night count (for the TV)</a>` : ""}
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
    <p class="row"><a href="/app/count.html">Election night count</a> · <a href="/results/">Results explorer</a></p>

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
              <span class="hint">${CATEGORY_LABELS[p.category]}${p.champion ? " · 🏆 champion" : ""} · ${p.scored} scores</span></td>
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
      <h3>Add a pizza or champion slot</h3>
      <input name="restaurant" required maxlength="60" placeholder="Restaurant">
      <input name="kind" maxlength="80" placeholder="What pizza">
      <fieldset>
        ${Object.entries(CATEGORY_LABELS).map(([k, l]) => `<label><input type="radio" name="category" value="${k}" required> ${l}</label>`).join("")}
        <label><input type="checkbox" name="champion"> Returning champion</label>
      </fieldset>
      <select name="bringer_id"><option value="">Brought by nobody yet</option>${approved
        .map((u) => `<option value="${u.id}">${esc(u.name)}</option>`)
        .join("")}</select>
      <button>Add</button>
    </form>`;
}

// ---------- events ----------

view.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form));
  const button = $("button:not([type])", form) || $("button", form);
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
        if (form.dataset.id) await api("PATCH", `/api/pizzas/${form.dataset.id}`, data);
        else await api("POST", "/api/pizzas", data);
        toast("Saved");
        return loadTab();
      case "score": {
        const pizzaId = Number(form.dataset.id);
        await api("PUT", "/api/tasting/score", { pizza_id: pizzaId, score: data.score });
        await api("POST", "/api/tasting/next");
        return loadTab();
      }
      case "admin-pizza":
        await api("POST", "/api/admin/pizzas", { ...data, champion: data.champion === "on", bringer_id: data.bringer_id || null });
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
    } else if (d.deletePizza) {
      if (!confirm("Delete this pizza?")) return;
      await api("DELETE", `/api/admin/pizzas/${d.deletePizza}`);
    } else return;
    await loadTab();
  } catch (err) {
    fail(err);
  }
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
    if (el.dataset.rescore) {
      await api("PUT", "/api/tasting/score", { pizza_id: Number(el.dataset.rescore), score: el.value });
      toast("Score updated");
    } else if (el.dataset.bringer) {
      await api("POST", `/api/admin/pizzas/${el.dataset.bringer}`, { bringer_id: el.value || null });
      toast("Saved");
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
