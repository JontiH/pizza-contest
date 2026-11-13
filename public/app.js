const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const voterId = localStorage.voterId || (localStorage.voterId = crypto.randomUUID());
const nameInput = $("#name");
nameInput.value = localStorage.voterName || "";
nameInput.addEventListener("input", () => (localStorage.voterName = nameInput.value.trim()));

// A share link like /?code=abc stores the party code so guests never type it.
const params = new URLSearchParams(location.search);
if (params.has("code")) {
  localStorage.partyCode = params.get("code");
  history.replaceState(null, "", location.pathname);
}

let state = { pizzas: [], voters: [], myVotes: [] };
let tab = "lineup";

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 2200);
}

async function api(method, path, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`/api/${path}`, {
      method,
      headers: { "content-type": "application/json", "x-party-code": localStorage.partyCode || "" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && attempt === 0) {
      const code = prompt("Enter the party code:");
      if (!code) break;
      localStorage.partyCode = code.trim();
      continue;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
    return data;
  }
  throw new Error("party code required");
}

function requireName() {
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.focus();
    toast("Enter your name first");
    return null;
  }
  return name;
}

async function refresh() {
  state = await api("GET", `state?voter=${encodeURIComponent(voterId)}`);
  renderLineup();
  renderResults();
  // Skip while someone is typing a note, so the poll doesn't wipe it.
  if (!document.activeElement?.closest("#vote-list")) renderVote();
}

function pizzaTitle(p) {
  return `${esc(p.restaurant)}${p.pizza ? ` <span class="meta">· ${esc(p.pizza)}</span>` : ""}`;
}

function renderLineup() {
  const list = $("#lineup-list");
  if (!state.pizzas.length) {
    list.innerHTML = `<li class="empty">No pizzas yet. Add yours above.</li>`;
    return;
  }
  list.innerHTML = state.pizzas
    .map(
      (p) => `<li class="card">
        <h3>${pizzaTitle(p)}</h3>
        <p class="meta">Brought by ${esc(p.brought_by)}${p.style ? ` · ${esc(p.style)}` : ""}</p>
        ${p.notes ? `<p class="meta">${esc(p.notes)}</p>` : ""}
        ${p.mine ? `<button class="remove" data-remove="${p.id}">Remove</button>` : ""}
      </li>`
    )
    .join("");
}

function renderVote() {
  const list = $("#vote-list");
  if (!state.pizzas.length) {
    list.innerHTML = `<li class="empty">Nothing to vote on yet.</li>`;
    return;
  }
  const mine = new Map(state.myVotes.map((v) => [v.pizza_id, v]));
  list.innerHTML = state.pizzas
    .map((p) => {
      const v = mine.get(p.id);
      const buttons = Array.from({ length: 10 }, (_, i) => i + 1)
        .map((n) => `<button data-pizza="${p.id}" data-score="${n}" class="${v?.score === n ? "on" : ""}">${n}</button>`)
        .join("");
      return `<li class="card">
        <h3>${pizzaTitle(p)}</h3>
        <p class="meta">Brought by ${esc(p.brought_by)}</p>
        <div class="scores">${buttons}</div>
        <input class="note" data-note="${p.id}" maxlength="280" placeholder="Tasting note (optional)" value="${esc(v?.note)}">
      </li>`;
    })
    .join("");
}

function renderResults() {
  const ranked = state.pizzas
    .filter((p) => p.votes > 0)
    .sort((a, b) => b.avg - a.avg || b.votes - a.votes);
  const unvoted = state.pizzas.length - ranked.length;

  $("#board").innerHTML = ranked.length
    ? ranked
        .map(
          (p, i) => `<li>
          <span class="rank">${i + 1}</span>
          <div>
            <strong>${esc(p.restaurant)}</strong>${p.pizza ? ` <span class="meta">· ${esc(p.pizza)}</span>` : ""}
            <div class="bar"><div style="width:${p.avg * 10}%"></div></div>
          </div>
          <span class="avg">${p.avg.toFixed(1)}<small>${p.votes} vote${p.votes === 1 ? "" : "s"}</small></span>
        </li>`
        )
        .join("") + (unvoted ? `<li class="empty" style="display:block">${unvoted} pizza${unvoted === 1 ? "" : "s"} with no votes yet</li>` : "")
    : `<li class="empty" style="display:block">No votes yet.</li>`;

  $("#voters").textContent = state.voters.length
    ? `Voted so far: ${state.voters.map((v) => `${v.name} (${v.votes})`).join(", ")}`
    : "";
}

async function saveVote(pizzaId, score, note) {
  const name = requireName();
  if (!name) return;
  try {
    await api("PUT", "votes", { voter_id: voterId, voter_name: name, pizza_id: pizzaId, score, note });
    const existing = state.myVotes.find((v) => v.pizza_id === pizzaId);
    if (score === null) state.myVotes = state.myVotes.filter((v) => v.pizza_id !== pizzaId);
    else if (existing) Object.assign(existing, { score, note });
    else state.myVotes.push({ pizza_id: pizzaId, score, note });
    renderVote();
    refresh();
  } catch (e) {
    toast(e.message);
  }
}

$("nav").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (!b) return;
  tab = b.dataset.tab;
  document.querySelectorAll("nav button").forEach((x) => x.classList.toggle("active", x === b));
  document.querySelectorAll("main section").forEach((s) => (s.hidden = s.id !== tab));
  refresh().catch((err) => toast(err.message));
});

$("#add").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = requireName();
  if (!name) return;
  const form = e.target;
  const data = Object.fromEntries(new FormData(form));
  try {
    await api("POST", "pizzas", { ...data, brought_by: name, voter_id: voterId });
    form.reset();
    toast("Added");
    await refresh();
  } catch (err) {
    toast(err.message);
  }
});

$("#lineup-list").addEventListener("click", async (e) => {
  const id = e.target.dataset.remove;
  if (!id || !confirm("Remove this pizza and its votes?")) return;
  try {
    await api("DELETE", `pizzas/${id}?voter=${encodeURIComponent(voterId)}`);
    await refresh();
  } catch (err) {
    toast(err.message);
  }
});

$("#vote-list").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-score]");
  if (!b) return;
  const pizzaId = Number(b.dataset.pizza);
  const score = Number(b.dataset.score);
  const current = state.myVotes.find((v) => v.pizza_id === pizzaId);
  const note = $(`[data-note="${pizzaId}"]`).value;
  // Tapping your current score again clears the vote.
  saveVote(pizzaId, current?.score === score ? null : score, note);
});

$("#vote-list").addEventListener("change", (e) => {
  const id = e.target.dataset.note;
  if (!id) return;
  const pizzaId = Number(id);
  const current = state.myVotes.find((v) => v.pizza_id === pizzaId);
  if (current) saveVote(pizzaId, current.score, e.target.value);
  else toast("Pick a score to save your note");
});

refresh().catch((err) => toast(err.message));
setInterval(() => {
  if (document.visibilityState === "visible") refresh().catch(() => {});
}, 15000);
