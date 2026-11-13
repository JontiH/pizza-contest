import { Needle, winChances } from "/assets/needle.js";
import { CATEGORY_LABELS, METHODS, analyse } from "/assets/tally.js";
import { $, api, esc, fmt } from "/assets/ui.js";

const status = $("#status");
const races = $("#races");
const ticker = $("#ticker");
const methodSelect = $("#method");

let data;
let order = [];
let counted = 0;
let auto = null;
let needles = {};
let cats = [];

function shuffle(xs) {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function start() {
  try {
    data = await api("GET", "/api/results");
  } catch (e) {
    status.textContent = e.status === 401 ? "Log in on the main page first." : e.message;
    $(".controls").hidden = true;
    return;
  }
  methodSelect.innerHTML = METHODS.map(
    (m) => `<option value="${m.key}" ${m.key === (data.officialMethod || "average") ? "selected" : ""}>${m.label}</option>`
  ).join("");
  cats = Object.keys(CATEGORY_LABELS).filter((c) => data.pizzas.some((p) => p.category === c));
  races.innerHTML = cats
    .map((c) => `<section class="race"><h2>${CATEGORY_LABELS[c]}</h2><div id="needle-${c}"></div><ol class="board" id="board-${c}"></ol></section>`)
    .join("");
  needles = Object.fromEntries(cats.map((c) => [c, new Needle($(`#needle-${c}`), c)]));
  restart();
}

function restart() {
  stopAuto();
  order = shuffle(data.voters.map((v) => v.id));
  counted = 0;
  ticker.textContent = "";
  draw();
}

function draw() {
  const method = methodSelect.value;
  const countedIds = order.slice(0, counted);
  const subset = { ...data, scores: data.scores.filter((o) => countedIds.includes(o.v)) };
  const done = counted === order.length;
  status.textContent = done
    ? `All ${order.length} ballots counted.`
    : `${counted} of ${order.length} ballots counted`;

  for (const c of cats) {
    const a = analyse(subset, c);
    const chances = winChances(data, c, countedIds, order.length, method, done ? 1 : 300);
    const ranking = a.rankings[method].filter((id) => counted === 0 || a.stats.get(id).n > 0);
    const pizzas = new Map(data.pizzas.map((p) => [p.id, p]));
    const byChance = [...chances].sort((x, y) => y[1] - x[1]);
    const [leader, p] = byChance[0] || [];
    if (leader !== undefined) {
      const name = esc(pizzas.get(leader).restaurant);
      needles[c].set(
        p,
        counted === 0
          ? "Waiting for the first ballot"
          : done
            ? `<strong>${name}</strong> wins`
            : `Chance <strong>${name}</strong> wins: <strong>${Math.round(p * 100)}%</strong>`
      );
      if (done) needles[c].stop();
    }
    // Runoff, STV and head-to-head have no single number per pizza, so
    // their boards show the average next to the method's order.
    const valueKey = a.values[method] ? method : "average";
    const val = a.values[valueKey];
    const scale = {
      average: (v) => (v - 1) / 9,
      adjusted: (v) => (v - 1) / 9,
      borda: (v) => v,
      firsts: (v) => v / Math.max(1, counted),
    }[valueKey];
    $(`#board-${c}`).innerHTML = ranking
      .slice(0, 6)
      .map((id, i) => {
        const v = val.get(id);
        const width = scale(v) * 100;
        return `<li>
          <span class="rank">${counted ? i + 1 : ""}</span>
          <span>${esc(pizzas.get(id).restaurant)}</span>
          <span class="val">${counted && Number.isFinite(v) ? fmt(v, method === "firsts" ? 1 : 2) : ""}</span>
          <span class="pct">${counted && !done ? `${Math.round((chances.get(id) || 0) * 100)}%` : ""}</span>
          <div class="bar"><div style="width:${counted && Number.isFinite(width) ? Math.max(0, width) : 0}%"></div></div>
        </li>`;
      })
      .join("");
  }
  $("#step").disabled = done;
  $("#all").disabled = done;
  $("#auto").disabled = done;
}

function step() {
  if (counted >= order.length) return stopAuto();
  const v = order[counted];
  counted += 1;
  const name = data.voters.find((x) => x.id === v).name;
  const top = data.scores.filter((o) => o.v === v).sort((a, b) => b.s - a.s)[0];
  const pizza = top && data.pizzas.find((p) => p.id === top.p);
  ticker.innerHTML = `Counting <strong>${esc(name)}</strong>'s ballot${pizza ? `: their favourite was <strong>${esc(pizza.restaurant)}</strong> (${fmt(top.s, 2)})` : ""}`;
  draw();
  if (counted >= order.length) stopAuto();
}

function stopAuto() {
  clearInterval(auto);
  auto = null;
  $("#auto").textContent = "Auto count";
}

$("#step").addEventListener("click", step);
$("#all").addEventListener("click", () => {
  stopAuto();
  counted = order.length;
  ticker.textContent = "";
  draw();
});
$("#auto").addEventListener("click", () => {
  if (auto) return stopAuto();
  $("#auto").textContent = "Pause";
  step();
  auto = setInterval(step, 3500);
});
$("#restart").addEventListener("click", () => {
  Object.values(needles).forEach((n) => n.stop());
  races.innerHTML = "";
  start();
});
methodSelect.addEventListener("change", draw);

start();
