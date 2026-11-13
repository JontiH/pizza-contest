import { CATEGORY_LABELS, METHODS, agreementLeague, analyse, person } from "./tally.js";
import { $, esc, fmt, ordinal } from "./ui.js";

const methodLabel = (k) => METHODS.find((m) => m.key === k)?.label ?? k;

// Score 1 -> cold blue, 10 -> hot red.
function heat(s) {
  const t = (s - 1) / 9;
  const hue = 220 - 220 * t;
  return `hsl(${hue} 75% ${88 - 30 * Math.abs(t - 0.5)}%)`;
}

export function mountExplorer(root, data, { official = "" } = {}) {
  const cats = Object.keys(CATEGORY_LABELS).filter((c) => data.pizzas.some((p) => p.category === c));
  if (!cats.length || !data.scores.length) {
    root.innerHTML = `<p class="empty">No scores yet.</p>`;
    return;
  }
  const pizza = new Map(data.pizzas.map((p) => [p.id, p]));
  const voter = new Map(data.voters.map((v) => [v.id, v]));
  const pname = (id) => esc(pizza.get(id)?.restaurant ?? "?");
  const headline = official || "average";
  let cat = cats[0];

  const dialog = document.createElement("dialog");
  document.body.append(dialog);
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog || e.target.closest("[data-close]")) dialog.close();
  });

  function render() {
    const a = analyse(data, cat);
    const ranked = a.rankings[headline].filter((id) => a.stats.get(id).n > 0);
    const voters = [...a.ballots.keys()].sort((x, y) => voter.get(x).name.localeCompare(voter.get(y).name));
    const cols = ranked;
    const slope = a.slope;

    root.innerHTML = `
      ${cats.length > 1 ? `<nav class="tabs">${cats.map((c) => `<button data-cat="${c}" class="${c === cat ? "active" : ""}">${CATEGORY_LABELS[c]}</button>`).join("")}</nav>` : ""}

      <section class="podium">
        ${ranked
          .slice(0, 3)
          .map(
            (id, i) => `<button class="step step-${i + 1}" data-pizza="${id}">
              <span class="medal">${["🥇", "🥈", "🥉"][i]}</span>
              <strong>${pname(id)}</strong>
              <span class="hint">${esc(pizza.get(id).kind)}</span>
              <span class="big">${fmt(a.stats.get(id).mean, 2)}</span>
              <span class="hint">average</span>
            </button>`
          )
          .join("")}
      </section>
      <p class="hint center">${official ? `Official method: <strong>${methodLabel(official)}</strong>.` : "No official method picked yet, so this shows the average."} Tap any pizza or person for details.</p>

      <div class="card fullness">
        <strong>The fullness effect:</strong>
        ${
          Math.abs(slope) < 0.005
            ? "slice order made no measurable difference."
            : `each extra slice ${slope < 0 ? "cost" : "added"} <strong>${fmt(Math.abs(slope), 2)}</strong> points on average, after allowing for harsh and generous scorers.`
        }
      </div>

      <h2>Every method</h2>
      <div class="scroll"><table class="methods">
        <tr><th>Pizza</th>${METHODS.map((m) => `<th title="${esc(m.blurb)}" class="${m.key === official ? "official" : ""}">${m.label}</th>`).join("")}</tr>
        ${ranked
          .map(
            (id) => `<tr>
              <td><button class="link" data-pizza="${id}">${pname(id)}</button></td>
              ${METHODS.map((m) => {
                const r = a.rankings[m.key].indexOf(id);
                const shown = m.key === "stv" ? (r >= 0 ? ordinal(r + 1) : "–") : ordinal(r + 1);
                return `<td class="${m.key === official ? "official" : ""} ${r === 0 ? "first" : ""}">${shown}</td>`;
              }).join("")}
            </tr>`
          )
          .join("")}
      </table></div>
      <details class="hint"><summary>What the methods mean</summary><dl>${METHODS.map((m) => `<dt>${m.label}</dt><dd>${esc(m.blurb)}</dd>`).join("")}</dl>
        ${a.condorcet ? `<p><strong>${pname(a.condorcet)}</strong> beat every other pizza one on one.</p>` : `<p>No pizza beat every other one on one.</p>`}
      </details>

      <h2>Everyone's scores</h2>
      <div class="scroll heat-wrap"><table class="heat">
        <tr><th></th>${cols.map((id) => `<th><button class="link" data-pizza="${id}">${pizza.get(id).box ? `#${pizza.get(id).box} ` : ""}${pname(id)}</button></th>`).join("")}</tr>
        ${voters
          .map((v) => {
            const b = a.ballots.get(v);
            return `<tr><th><button class="link" data-voter="${v}">${esc(voter.get(v).name)}</button></th>${cols
              .map((id) => (b.has(id) ? `<td style="background:${heat(b.get(id))}">${fmt(b.get(id), b.get(id) % 1 ? 1 : 0)}</td>` : `<td class="none">·</td>`))
              .join("")}</tr>`;
          })
          .join("")}
        <tr class="avg"><th>Average</th>${cols.map((id) => `<td>${fmt(a.stats.get(id).mean, 2)}</td>`).join("")}</tr>
      </table></div>

      <h2>Head to head</h2>
      <p class="hint">How many people preferred the row's pizza over the column's, among those who tasted both.</p>
      <div class="scroll"><table class="h2h">
        <tr><th></th>${cols.map((id) => `<th>${pname(id)}</th>`).join("")}</tr>
        ${cols
          .map(
            (x) => `<tr><th>${pname(x)}</th>${cols
              .map((y) => {
                if (x === y) return `<td class="none"></td>`;
                const w = a.pairwise.get(x).get(y);
                const l = a.pairwise.get(y).get(x);
                return `<td class="${w > l ? "win" : w < l ? "loss" : ""}">${w}–${l}</td>`;
              })
              .join("")}</tr>`
          )
          .join("")}
      </table></div>

      <h2>Instant runoff, round by round</h2>
      <div class="scroll"><table class="rounds">
        <tr><th>Round</th>${cols.map((id) => `<th>${pname(id)}</th>`).join("")}<th></th></tr>
        ${a.irvRounds
          .map(
            (r, i) => `<tr><td>${i + 1}</td>${cols
              .map((id) => `<td>${r.tally.has(id) ? fmt(r.tally.get(id), r.tally.get(id) % 1 ? 1 : 0) : ""}</td>`)
              .join("")}<td>${r.eliminated ? `${pname(r.eliminated)} out` : `${pname(r.winner)} wins`}</td></tr>`
          )
          .join("")}
      </table></div>`;
  }

  function pizzaDialog(id) {
    const p = pizza.get(id);
    const a = analyse(data, p.category);
    const st = a.stats.get(id);
    const rows = data.scores.filter((o) => o.p === id).sort((x, y) => y.s - x.s);
    const others = a.ids.filter((o) => o !== id && a.stats.get(o).n > 0);
    const h2hWins = others.filter((o) => a.pairwise.get(id).get(o) > a.pairwise.get(o).get(id)).length;
    dialog.innerHTML = `
      <button class="close secondary small" data-close>Close</button>
      <h2 style="margin-top:0">${p.box ? `#${p.box} ` : ""}${esc(p.restaurant)}</h2>
      <p class="hint">${esc(p.kind)}${p.kind ? " · " : ""}${CATEGORY_LABELS[p.category]}${p.champion ? " · 🏆 returning champion" : ""}${p.bringer ? ` · brought by ${esc(p.bringer)}` : ""}</p>
      <div class="statline">
        <span><strong>${fmt(st.mean, 2)}</strong> average</span>
        <span><strong>${fmt(st.median, 2)}</strong> median</span>
        <span><strong>±${fmt(st.sd, 2)}</strong> spread</span>
        <span><strong>${st.n}</strong> scores</span>
      </div>
      ${dotPlot(rows.map((o) => ({ s: o.s, label: voter.get(o.v).name })))}
      <p>${st.sd >= 2 ? "People were split on this one." : st.sd <= 0.8 && st.n > 2 ? "Remarkable agreement on this one." : ""}
        Beat ${h2hWins} of ${others.length} other pizzas head to head.</p>
      <h3>Rank by method</h3>
      <ul class="pills">${METHODS.map((m) => {
        const r = a.rankings[m.key].indexOf(id);
        return `<li>${m.label}: <strong>${m.key === "stv" && r < 0 ? "not on podium" : ordinal(r + 1)}</strong></li>`;
      }).join("")}</ul>
      <h3>Everyone's score</h3>
      <table class="list">${rows
        .map(
          (o) => `<tr><td><button class="link" data-voter="${o.v}">${esc(voter.get(o.v).name)}</button></td><td><strong>${fmt(o.s, 2)}</strong></td><td class="hint">${ordinal(o.pos)} slice</td></tr>${
            o.note ? `<tr class="note-row"><td colspan="3">“${esc(o.note)}”</td></tr>` : ""
          }`
        )
        .join("")}</table>`;
    if (!dialog.open) dialog.showModal();
  }

  function voterDialog(v) {
    const info = person(data, v);
    const league = agreementLeague(data);
    const place = league.findIndex((x) => x.v === v);
    dialog.innerHTML = `
      <button class="close secondary small" data-close>Close</button>
      <h2 style="margin-top:0">${esc(voter.get(v).name)}</h2>
      ${
        place >= 0
          ? `<p>${ordinal(place + 1)} most in tune with the group, out of ${league.length}
             <span class="hint">(agreement ${fmt(info.agreement, 2)}, where 1 means their scores rose and fell exactly with everyone else's)</span></p>`
          : ""
      }
      ${info.twin ? `<p>Taste twin: <button class="link" data-voter="${info.twin.v}">${esc(voter.get(info.twin.v).name)}</button> <span class="hint">(${fmt(info.twin.r, 2)} over ${info.twin.shared} shared pizzas)</span></p>` : ""}
      ${
        info.hotTakes.length
          ? `<h3>Hot takes</h3><ul>${info.hotTakes
              .map(
                (h) => `<li><button class="link" data-pizza="${h.p}">${pname(h.p)}</button>: gave ${fmt(h.s, 2)}, everyone else averaged ${fmt(h.others, 2)}</li>`
              )
              .join("")}</ul>`
          : ""
      }
      <h3>Their ranking</h3>
      <table class="list">${info.ranking
        .map(
          (o, i) => `<tr><td>${i + 1}.</td><td><button class="link" data-pizza="${o.p}">${pname(o.p)}</button> <span class="hint">${CATEGORY_LABELS[pizza.get(o.p).category]}</span></td><td><strong>${fmt(o.s, 2)}</strong></td><td class="hint">${ordinal(o.pos)} slice</td></tr>${
            o.note ? `<tr class="note-row"><td></td><td colspan="3">“${esc(o.note)}”</td></tr>` : ""
          }`
        )
        .join("")}</table>`;
    if (!dialog.open) dialog.showModal();
  }

  const onClick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.cat) {
      cat = b.dataset.cat;
      render();
    } else if (b.dataset.pizza) pizzaDialog(Number(b.dataset.pizza));
    else if (b.dataset.voter) voterDialog(Number(b.dataset.voter));
  };
  root.addEventListener("click", onClick);
  dialog.addEventListener("click", onClick);
  render();
}

function dotPlot(points) {
  const x = (s) => 12 + ((s - 1) / 9) * 276;
  const stacks = new Map();
  const dots = points.map((p) => {
    const key = Math.round(p.s * 4) / 4;
    const n = stacks.get(key) || 0;
    stacks.set(key, n + 1);
    return `<circle cx="${x(p.s)}" cy="${44 - n * 9}" r="4.5" fill="hsl(${220 - (220 * (p.s - 1)) / 9} 70% 45%)"><title>${esc(p.label)}: ${p.s}</title></circle>`;
  });
  return `<svg viewBox="0 0 300 66" class="dots" role="img" aria-label="Score distribution">
    <line x1="12" y1="52" x2="288" y2="52" stroke="#ccc"/>
    ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((t) => `<text x="${x(t)}" y="64" font-size="8" text-anchor="middle" fill="#8a776a">${t}</text>`).join("")}
    ${dots.join("")}
  </svg>`;
}
