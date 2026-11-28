import { CATEGORY_LABELS, METHODS, agreementLeague, analyse, person } from "./tally.js";
import { $, esc, fmt, medal, ordinal } from "./ui.js";


// Score 0 -> cold blue, 10 -> hot red.
function heat(s) {
  const t = s / 10;
  const hue = 220 - 220 * t;
  return `hsl(${hue} 75% ${88 - 30 * Math.abs(t - 0.5)}%)`;
}

// Returns { update(newData) } to redraw in place as ballots arrive.
export function mountExplorer(root, initial, { official = "" } = {}) {
  let data = initial;
  let cats, pizza, voter, cat;
  let method = official || "average";
  const load = () => {
    cats = Object.keys(CATEGORY_LABELS).filter((c) => data.pizzas.some((p) => p.category === c));
    pizza = new Map(data.pizzas.map((p) => [p.id, p]));
    voter = new Map(data.voters.map((v) => [v.id, v]));
    if (!cats.includes(cat)) cat = cats[0];
  };
  load();
  const pname = (id) => esc(pizza.get(id)?.restaurant ?? "?");
  const v1 = (id) => (pizza.get(id)?.champion ? medal("v1", pizza.get(id).placing) : "");

  const dialog = document.createElement("dialog");
  document.body.append(dialog);
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog || e.target.closest("[data-close]")) dialog.close();
  });

  function render() {
    if (!cats.length || !data.scores.length) {
      root.innerHTML = `<p class="empty">No scores yet.</p>`;
      return;
    }
    const a = analyse(data, cat);
    const voted = a.ids.filter((id) => a.stats.get(id).n > 0);
    // Elected-only methods (STV) rank just a few; the rest follow by average.
    const order = [...a.rankings[method].filter((id) => voted.includes(id))];
    for (const id of a.rankings.average) if (voted.includes(id) && !order.includes(id)) order.push(id);
    const rankOf = (id) => (a.rankings[method].includes(id) ? a.rankings[method].indexOf(id) + 1 : 0);
    const v2 = (id) => medal("v2", order.indexOf(id) + 1);
    const badges = (id) => `${v2(id)} ${v1(id)}`;
    const ranked = a.rankings.average.filter((id) => voted.includes(id));
    const voters = [...a.ballots.keys()].sort((x, y) => voter.get(x).name.localeCompare(voter.get(y).name));
    const cols = order;
    const slope = a.slope;
    const tabs = cats.length > 1 ? cats : [];
    const m = METHODS.find((x) => x.key === method);

    root.innerHTML = `
      ${tabs.length ? `<nav class="tabs">${tabs.map((c) => `<button data-cat="${c}" class="${c === cat ? "active" : ""}">${CATEGORY_LABELS[c]}</button>`).join("")}</nav>` : ""}

      <div class="card method-pick">
        <label class="field">Rank pizzas by
          <select data-method>${METHODS.map((x) => `<option value="${x.key}" ${x.key === method ? "selected" : ""}>${x.label}${x.key === official ? " (official)" : ""}</option>`).join("")}</select>
        </label>
        <p class="hint">${esc(m.blurb)}</p>
      </div>

      <h2>Everyone's scores</h2>
      <p class="hint">Pizzas run left to right in ${m.label.toLowerCase()} order. Tap any pizza or person for details.</p>
      <div class="scroll heat-wrap"><table class="heat">
        <tr><th></th>${cols.map((id) => `<th><button class="link" data-pizza="${id}">${pizza.get(id).box ? `#${pizza.get(id).box} ` : ""}${pname(id)}</button></th>`).join("")}</tr>
        <tr class="rankrow"><th>${m.label}</th>${cols.map((id) => `<td>${rankOf(id) ? ordinal(rankOf(id)) : "–"}</td>`).join("")}</tr>
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

      <h2>Fun facts</h2>
      <div class="facts">${funFacts(a, voter, pname)
        .map((f) => `<div class="card fact">${f}</div>`)
        .join("")}
        ${
          a.worst !== null
            ? `<button class="card fact worst" data-pizza="${a.worst}">
                <span class="medal">🗑️</span>
                <span><strong>Worst pizza: ${pname(a.worst)}</strong><br>
                <span class="hint">Lowest score for ${fmt(a.values.worsts.get(a.worst), a.values.worsts.get(a.worst) % 1 ? 1 : 0)} ${
                  a.values.worsts.get(a.worst) === 1 ? "person" : "people"
                } · averaged ${fmt(a.stats.get(a.worst).mean, 2)}</span></span>
              </button>`
            : ""
        }
        <div class="card fact fullness">
          <strong>The fullness effect:</strong>
          ${
            Math.abs(slope) < 0.005
              ? "slice order made no measurable difference."
              : `each extra slice ${slope < 0 ? "cost" : "added"} <strong>${fmt(Math.abs(slope), 2)}</strong> points on average, after allowing for harsh and generous scorers.`
          }
        </div>
      </div>

      <details class="more">
        <summary>How every method ranks each pizza</summary>
        <div class="scroll"><table class="methods">
          <tr><th>Pizza</th>${METHODS.map((x) => `<th title="${esc(x.blurb)}" class="${x.key === method ? "official" : ""}">${x.label}</th>`).join("")}<th title="How many people scored it their lowest">Most worsts</th></tr>
          ${ranked
            .map(
              (id) => `<tr>
                <td><button class="link" data-pizza="${id}">${pname(id)}</button> ${badges(id)}</td>
                ${METHODS.map((x) => {
                  const r = a.rankings[x.key].indexOf(id);
                  const shown = r >= 0 ? ordinal(r + 1) : "–";
                  return `<td class="${x.key === method ? "official" : ""} ${r === 0 ? "first" : ""}">${shown}</td>`;
                }).join("")}
                <td class="${id === a.worst ? "first" : ""}">${fmt(a.values.worsts.get(id), a.values.worsts.get(id) % 1 ? 1 : 0)}${id === a.worst ? " 🗑️" : ""}</td>
              </tr>`
            )
            .join("")}
        </table></div>
        ${a.condorcet ? `<p><strong>${pname(a.condorcet)}</strong> beat every other pizza one on one.</p>` : `<p class="hint">No pizza beat every other one on one.</p>`}
      </details>

      <details class="more">
        <summary>Head to head, match by match</summary>
        <p class="hint">How many people preferred the row's pizza over the column's, among those who tasted both.</p>
        <div class="scroll"><table class="h2h">
          <tr><th></th>${ranked.map((id) => `<th>${pname(id)}</th>`).join("")}</tr>
          ${ranked
            .map(
              (x) => `<tr><th>${pname(x)}</th>${ranked
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
      </details>

      <details class="more">
        <summary>Instant runoff, round by round</summary>
        <div class="scroll"><table class="rounds">
          <tr><th>Round</th>${ranked.map((id) => `<th>${pname(id)}</th>`).join("")}<th></th></tr>
          ${a.irvRounds
            .map(
              (r, i) => `<tr><td>${i + 1}</td>${ranked
                .map((id) => `<td>${r.tally.has(id) ? fmt(r.tally.get(id), r.tally.get(id) % 1 ? 1 : 0) : ""}</td>`)
                .join("")}<td>${r.eliminated ? `${pname(r.eliminated)} out` : `${pname(r.winner)} wins`}</td></tr>`
            )
            .join("")}
        </table></div>
      </details>`;
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
      <p>${medal("v2", a.rankings[method].filter((x) => a.stats.get(x).n > 0).indexOf(id) + 1)} ${v1(id)}</p>
      <p class="hint">${esc(p.kind)}${p.kind ? " · " : ""}${CATEGORY_LABELS[p.category]}${p.bringer ? ` · brought by ${esc(p.bringer)}` : ""}</p>
      <div class="statline">
        <span><strong>${fmt(st.mean, 2)}</strong> average</span>
        <span><strong>${fmt(st.median, 2)}</strong> median</span>
        <span><strong>±${fmt(st.sd, 2)}</strong> spread</span>
        <span><strong>${st.n}</strong> scores</span>
      </div>
      ${dotPlot(rows.map((o) => ({ s: o.s, label: voter.get(o.v).name })))}
      <p>${st.sd >= 2 ? "People were split on this one." : st.sd <= 0.8 && st.n > 2 ? "Remarkable agreement on this one." : ""}
        Beat ${h2hWins} of ${others.length} other pizzas head to head.
        ${a.values.worsts.get(id) ? `Lowest score for ${fmt(a.values.worsts.get(id), a.values.worsts.get(id) % 1 ? 1 : 0)} ${a.values.worsts.get(id) === 1 ? "person" : "people"}${id === a.worst ? " 🗑️" : ""}.` : ""}</p>
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
  root.addEventListener("change", (e) => {
    if (e.target.dataset.method === undefined) return;
    method = e.target.value;
    render();
  });
  dialog.addEventListener("click", onClick);
  render();
  return {
    update(next) {
      data = next;
      load();
      render();
    },
  };
}

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// Short, plain-language facts about the current tab. Each entry is HTML.
function funFacts(a, voter, pname) {
  const facts = [];
  const link = (id) => `<button class="link" data-pizza="${id}">${pname(id)}</button>`;
  const who = (v) => `<button class="link" data-voter="${v}">${esc(voter.get(v).name)}</button>`;

  const rated = a.ids.filter((id) => a.stats.get(id).n >= 3);
  if (rated.length >= 2) {
    const bySpread = [...rated].sort((x, y) => a.stats.get(y).sd - a.stats.get(x).sd);
    const split = bySpread[0];
    const agreed = bySpread[bySpread.length - 1];
    facts.push(`<strong>Most divisive:</strong> ${link(split)}. Scores ranged from ${fmt(Math.min(...a.stats.get(split).scores), 1)} to ${fmt(Math.max(...a.stats.get(split).scores), 1)}.`);
    if (agreed !== split) facts.push(`<strong>Most agreed on:</strong> ${link(agreed)}. Everyone landed within about ${fmt(a.stats.get(agreed).sd, 1)} points of ${fmt(a.stats.get(agreed).mean, 1)}.`);
  }

  const people = [...a.ballots].filter(([, b]) => b.size >= 3).map(([v, b]) => ({ v, m: avg([...b.values()]) }));
  if (people.length >= 2) {
    people.sort((x, y) => x.m - y.m);
    facts.push(`<strong>Toughest critic:</strong> ${who(people[0].v)}, who averaged ${fmt(people[0].m, 1)}.`);
    facts.push(`<strong>Easiest to please:</strong> ${who(people[people.length - 1].v)}, who averaged ${fmt(people[people.length - 1].m, 1)}.`);
  }

  let take = null;
  for (const [v, b] of a.ballots) {
    for (const [id, s] of b) {
      const st = a.stats.get(id);
      if (st.n < 3) continue;
      const others = (st.mean * st.n - s) / (st.n - 1);
      if (!take || Math.abs(s - others) > Math.abs(take.s - take.others)) take = { v, id, s, others };
    }
  }
  if (take && Math.abs(take.s - take.others) >= 1.5) {
    facts.push(`<strong>Biggest hot take:</strong> ${who(take.v)} gave ${link(take.id)} a ${fmt(take.s, take.s % 1 ? 1 : 0)}. Everyone else averaged ${fmt(take.others, 1)}.`);
  }

  const all = [...a.ballots.values()].flatMap((b) => [...b.values()]);
  if (all.length) {
    const tens = all.filter((s) => s === 10).length;
    const zeros = all.filter((s) => s === 0).length;
    facts.push(`<strong>In total:</strong> ${all.length} scores from ${a.ballots.size} ${a.ballots.size === 1 ? "person" : "people"}, averaging ${fmt(avg(all), 2)}. ${tens} perfect ${tens === 1 ? "10" : "10s"}${zeros ? ` and ${zeros} ${zeros === 1 ? "zero" : "zeros"}` : ""}.`);
  }
  return facts;
}

function dotPlot(points) {
  const x = (s) => 12 + (s / 10) * 276;
  const stacks = new Map();
  const dots = points.map((p) => {
    const key = Math.round(p.s * 4) / 4;
    const n = stacks.get(key) || 0;
    stacks.set(key, n + 1);
    return `<circle cx="${x(p.s)}" cy="${44 - n * 9}" r="4.5" fill="hsl(${220 - 22 * p.s} 70% 45%)"><title>${esc(p.label)}: ${p.s}</title></circle>`;
  });
  return `<svg viewBox="0 0 300 66" class="dots" role="img" aria-label="Score distribution">
    <line x1="12" y1="52" x2="288" y2="52" stroke="#ccc"/>
    ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((t) => `<text x="${x(t)}" y="64" font-size="8" text-anchor="middle" fill="#8a776a">${t}</text>`).join("")}
    ${dots.join("")}
  </svg>`;
}
