import { PHOTOS } from "./pizzas.js";
import { CATEGORY_LABELS, METHODS, agreementLeague, analyse, person, rank, ballotsFor, stats } from "./tally.js";
import { $, esc, fmt, medal, ordinal } from "./ui.js";


// Score 0 -> cold blue, 10 -> hot red.
function heat(s) {
  const t = s / 10;
  const hue = 220 - 220 * t;
  return `hsl(${hue} 75% ${88 - 30 * Math.abs(t - 0.5)}%)`;
}

// data.final: voting is over, so the winners and worst pizza lead the page.
// Returns { update(newData) } to redraw in place as ballots arrive.
export function mountExplorer(root, initial, { official = "" } = {}) {
  let data = initial;
  let cats, pizza, voter, cat;
  let pickerOpen = false;
  let method = METHODS.some((m) => m.key === official) ? official : "average";
  const load = () => {
    cats = Object.keys(CATEGORY_LABELS).filter((c) => data.pizzas.some((p) => p.category === c));
    pizza = new Map(data.pizzas.map((p) => [p.id, p]));
    voter = new Map(data.voters.map((v) => [v.id, v]));
    if (cat !== "all" && !cats.includes(cat)) cat = cats[0];
  };
  load();
  const pname = (id) => esc(pizza.get(id)?.restaurant ?? "?");
  const v1 = (id) => (pizza.get(id)?.champion ? medal("v1", pizza.get(id).placing) : "");

  const dialog = document.createElement("dialog");
  document.body.append(dialog);
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog || e.target.closest("[data-close]")) dialog.close();
  });

  // Election-night style results box: one row per pizza in the chosen
  // method's order, a colour stripe each, and a bar for how much is counted.
  const byLink = (name) => (name ? `<button class="link" data-person="${esc(name)}">${esc(name)}</button>` : "");
  const head = (id, cls = "") =>
    `<span class="head ${cls}" style="--c:${colourOf(id)}">${PHOTOS.has(id) && !data.fake ? `<img src="/assets/pizzas/${id}.jpg" alt="">` : "🍕"}</span>`;

  function raceCard(a, order, method, cat, final) {
    const vals = valuesFor(a, method);
    const nums = order.map((id) => vals.get(id)).filter(Number.isFinite);
    const top = Math.max(...nums, 0) || 1;
    const catPizzas = a.ids.length;
    const tasted = [...a.ballots.values()].reduce((n, b) => n + b.size, 0);
    const possible = Math.max(data.expectedVoters ?? 0, a.ballots.size) * catPizzas;
    const tastedPct = possible ? Math.round((tasted / possible) * 100) : 0;
    const left = possible - tasted;
    const title = cat === "all" ? "Every pizza" : CATEGORY_LABELS[cat];
    const m = METHODS.find((x) => x.key === method);
    return `
      <section class="race-card">
        <div class="race-stripe">${order.slice(0, 6).map((id) => `<span style="background:${colourOf(id)}"></span>`).join("")}</div>
        <h2 class="race-title"><span class="race-logo">🍕</span> 2026 ${esc(title)}</h2>
        <table class="race-table">
          <thead><tr><th>Pizza</th><th class="by">Brought by</th><th class="num">Scores</th><th class="num">${esc(m.short)}</th></tr></thead>
          <tbody>${order
            .map((id, i) => {
              const v = vals.get(id);
              const width = Number.isFinite(v) ? Math.max(2, (v / top) * 100) : 0;
              return `<tr class="${i === 0 ? "lead" : ""}" style="--c:${colourOf(id)}">
                <td class="who">${head(id)}<span><button class="link" data-pizza="${id}">${pname(id)}</button>${i === 0 && final ? " ✓" : ""}
                  <span class="race-bar"><span style="width:${width}%"></span></span></span></td>
                <td class="by">${byLink(pizza.get(id).bringer)}</td>
                <td class="num">${a.stats.get(id).n}</td>
                <td class="num strong">${fmtValue(method, v)}</td>
              </tr>`;
            })
            .join("")}</tbody>
        </table>
        <div class="race-foot">
          <span><span class="dot ${final ? "final" : "live"}"></span>${final ? "Final" : "Counting"}</span>
          <span class="hint">${tasted} ${tasted === 1 ? "score" : "scores"} from ${a.ballots.size} ${a.ballots.size === 1 ? "person" : "people"}</span>
        </div>
        <div class="race-progress">
          <span class="hint">${tastedPct >= 95 && tastedPct < 100 ? ">95" : tastedPct}% of slices tasted${left > 0 && !final ? ` · about ${left} to go` : ""}</span>
          <span class="track"><span style="width:${tastedPct}%"></span></span>
        </div>
      </section>`;
  }

  // Folded sections keep their open/closed state when results redraw.
  const openState = new Map();
  function render() {
    for (const d of root.querySelectorAll("details[data-key]")) openState.set(d.dataset.key, d.open);
    draw();
    for (const d of root.querySelectorAll("details[data-key]")) if (openState.has(d.dataset.key)) d.open = openState.get(d.dataset.key);
  }

  function draw() {
    const final = !!data.final;
    if (!cats.length || !data.scores.length) {
      root.innerHTML = `<p class="empty">No scores yet.</p>`;
      return;
    }
    const a = analyse(data, cat === "all" ? null : cat);
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
    const tabs = cats.length > 1 ? [...cats, "all"] : [];
    const m = METHODS.find((x) => x.key === method);

    const worstCard =
      a.worst !== null
        ? `<button class="card fact worst" data-pizza="${a.worst}">
            <span class="medal">🗑️</span>
            <span><strong>Worst pizza: ${pname(a.worst)}</strong><br>
            <span class="hint">Lowest score for ${fmt(a.values.worsts.get(a.worst), a.values.worsts.get(a.worst) % 1 ? 1 : 0)} ${
              a.values.worsts.get(a.worst) === 1 ? "person" : "people"
            } · averaged ${fmt(a.stats.get(a.worst).mean, 2)}</span></span>
          </button>`
        : "";
    const podium = `
      <section class="winners">
        ${order
          .slice(0, 3)
          .map(
            (id, i) => `<button class="cand cand-${i + 1}" data-pizza="${id}" style="--c:${colourOf(id)}">
              ${i === 0 ? `<span class="cand-banner">✓ Winner</span>` : `<span class="cand-place">${ordinal(i + 1)}</span>`}
              ${head(id, "big")}
              <strong class="cand-name">${pname(id)}</strong>
              <span class="hint">${esc(pizza.get(id).kind)}</span>
              ${pizza.get(id).bringer ? `<span class="cand-party">Brought by ${esc(pizza.get(id).bringer)}</span>` : ""}
              <span class="cand-score">${fmtValue(method, valuesFor(a, method).get(id))}</span>
              <span class="hint">${esc(m.label.toLowerCase())}</span>
            </button>`
          )
          .join("")}
      </section>
      ${worstCard}`;

    root.innerHTML = `
      ${tabs.length ? `<nav class="tabs">${tabs.map((c) => `<button data-cat="${c}" class="${c === cat ? "active" : ""}">${c === "all" ? "Combined" : CATEGORY_LABELS[c]}</button>`).join("")}</nav>` : ""}

      ${final ? podium : ""}

      <details class="card method-pick" ${pickerOpen ? "open" : ""}>
        <summary><span class="hint">Rank pizzas by</span> <strong>${m.label}</strong>${method === official ? ` <span class="badge">official</span>` : ""}</summary>
        <ul class="method-list">${METHODS.map(
          (x) => `<li><button class="method-opt ${x.key === method ? "on" : ""}" data-pick-method="${x.key}">
            <strong>${x.label}${x.key === official ? ` <span class="badge">official</span>` : ""}</strong>
            <span>${esc(x.blurb)}</span>
          </button></li>`
        ).join("")}</ul>
      </details>

      ${raceCard(a, order, method, cat, final)}


      ${
        data.you != null
          ? voter.has(data.you)
            ? `<details class="more" data-key="you" open><summary>Your scores</summary><div class="card you">${personRanking(data.you, true)}</div></details>
               <details class="more" data-key="youfacts"><summary>Fun facts about you</summary>${personFacts(data.you, true) || `<p class="hint">Score a few more pizzas first.</p>`}</details>`
            : `<details class="more" data-key="you" open><summary>Your scores</summary><p class="hint">You haven't scored anything yet.</p></details>`
          : ""
      }

      <details class="more" data-key="heat" open>
      <summary>Everyone's scores</summary>
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
      </details>

      <details class="more" data-key="facts">
      <summary>Fun facts about everyone</summary>
      <div class="facts">${awards([
        ...funFacts(a, data, voter, pname),
        {
          icon: "😮‍💨",
          title: "The fullness effect",
          colour: "#00838f",
          wide: true,
          body:
            Math.abs(slope) < 0.005
              ? "Slice order made no difference."
              : `Each extra slice ${slope < 0 ? "cost" : "added"} <strong>${fmt(Math.abs(slope), 2)}</strong> points.`,
        },
      ])}</div>
      </details>

      <details class="more" data-key="methods">
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
      </details>`;
  }

  function pizzaDialog(id) {
    const p = pizza.get(id);
    const a = analyse(data, p.category);
    const st = a.stats.get(id);
    const rows = data.scores.filter((o) => o.p === id).sort((x, y) => y.s - x.s);
    const others = a.ids.filter((o) => o !== id && a.stats.get(o).n > 0);
    dialog.innerHTML = `
      <button class="close secondary small" data-close>Close</button>
      <div class="pizza-top">
        <div>
          <h2 style="margin-top:0">${p.box ? `#${p.box} ` : ""}${esc(p.restaurant)}</h2>
          <p>${medal("v2", a.rankings[method].filter((x) => a.stats.get(x).n > 0).indexOf(id) + 1)} ${v1(id)}</p>
          <p class="hint">${esc(p.kind)}${p.kind ? " · " : ""}${CATEGORY_LABELS[p.category]}${p.bringer ? ` · brought by ${esc(p.bringer)}` : ""}</p>
        </div>
        ${head(id, "photo")}
      </div>
      <div class="statline">
        <span><strong>${fmt(st.mean, 2)}</strong> average</span>
        <span><strong>${fmt(st.median, 2)}</strong> median</span>
        <span><strong>±${fmt(st.sd, 2)}</strong> spread</span>
        <span><strong>${st.n}</strong> scores</span>
      </div>
      ${dotPlot(rows.map((o) => ({ s: o.s, label: voter.get(o.v).name })))}
      <p>${st.sd >= 2 ? "People were split on this one." : st.sd <= 0.8 && st.n > 2 ? "Remarkable agreement on this one." : ""}
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

  // Agreement, taste twin, hot takes and ranking for one voter. Used for
  // the "Your scores" section and for tapping anyone's name.
  function personHtml(v, own) {
    return personFacts(v, own) + personRanking(v, own);
  }

  // Kept to things the group facts don't already say.
  function personFacts(v, own) {
    const info = person(data, v);
    const name = esc(voter.get(v).name);
    const you = own ? "you" : name;
    const Your = own ? "Your" : `${name}'s`;
    const who = (x) => `<button class="link" data-voter="${x}">${esc(voter.get(x).name)}</button>`;
    const link = (id) => `<button class="link" data-pizza="${id}">${pname(id)}</button>`;
    const out = [];
    const mine = data.scores.filter((o) => o.v === v);

    if (info.twin) out.push({ icon: "👯", title: "Taste twin", colour: "#c2187a", body: `${who(info.twin.v)}. Scored the most like ${you} on ${info.twin.shared} shared pizzas.` });
    if (info.nemesis) out.push({ icon: "⚔️", title: "Taste nemesis", colour: "#6d4c41", body: `${who(info.nemesis.v)}. Scored the most unlike ${you} on ${info.nemesis.shared} shared pizzas.` });

    // The score furthest from the group, measured against how much the group
    // itself disagreed about that pizza.
    let take = null;
    for (const o of mine) {
      const xs = data.scores.filter((x) => x.p === o.p && x.v !== v).map((x) => x.s);
      if (xs.length < 3) continue;
      const m = avg(xs);
      const sd = Math.sqrt(xs.reduce((t, x) => t + (x - m) ** 2, 0) / (xs.length - 1));
      const z = (o.s - m) / Math.max(sd, 0.5);
      if (!take || Math.abs(z) > Math.abs(take.z)) take = { ...o, m, z };
    }
    if (take && Math.abs(take.z) >= 1) {
      out.push({ icon: "🌶️", title: "Hottest take", colour: "#d22f27", body: `${own ? "You" : name} gave ${link(take.p)} <strong>${fmt(take.s, take.s % 1 ? 1 : 0)}</strong>. Everyone else: ${fmt(take.m, 1)}.` });
    }

    const top = [...mine].sort((x, y) => y.s - x.s)[0];
    if (top) {
      const ca = analyse(data, pizza.get(top.p).category);
      const overall = ca.rankings.average.filter((id) => ca.stats.get(id).n > 0);
      const r = overall.indexOf(top.p) + 1;
      if (r > 0)
        out.push({
          icon: r === 1 ? "🎯" : "🧭",
          title: r === 1 ? "Called it" : `${Your} #1`,
          colour: "#1f5fd1",
          body: r === 1 ? `${link(top.p)}, ${own ? "your" : "their"} favourite, is winning.` : `${link(top.p)}. The room has it ${ordinal(r)} of ${overall.length}.`,
        });
    }

    // Would the winner change without this person's ballot?
    for (const c of Object.keys(CATEGORY_LABELS)) {
      const ids = data.pizzas.filter((p) => p.category === c).map((p) => p.id);
      if (!mine.some((o) => ids.includes(o.p))) continue;
      const winner = (d) => {
        const { ballots } = ballotsFor(d, c);
        return rank(method, ids, ballots, stats(ids, ballots), d)[0];
      };
      const withMe = winner(data);
      const without = winner({ ...data, scores: data.scores.filter((o) => o.v !== v) });
      if (withMe !== without)
        out.push({ icon: "👑", title: "Kingmaker", colour: "#8a3ffc", wide: true, body: `Without ${own ? "your" : "their"} votes, ${link(without)} would be winning ${CATEGORY_LABELS[c]} instead of ${link(withMe)}.` });
    }
    return out.length ? `<div class="facts">${awards(out)}</div>` : "";
  }

  function personRanking(v, own) {
    const info = person(data, v);
    const all = analyse(data, null).stats;
    return `
      ${own ? "" : "<h3>Their ranking</h3>"}
      <table class="list">
        <tr class="hint"><td></td><td></td><td>${own ? "You" : "Them"}</td><td>Everyone</td><td></td></tr>
        ${info.ranking
          .map(
            (o, i) => `<tr><td>${i + 1}.</td><td><button class="link" data-pizza="${o.p}">${pname(o.p)}</button> <span class="hint">${CATEGORY_LABELS[pizza.get(o.p).category]}</span></td><td><strong>${fmt(o.s, 2)}</strong></td><td>${fmt(all.get(o.p).mean, 2)}</td><td class="hint">${ordinal(o.pos)} slice</td></tr>${
              o.note ? `<tr class="note-row"><td></td><td colspan="4">“${esc(o.note)}”</td></tr>` : ""
            }`
          )
          .join("")}</table>`;
  }

  function voterDialog(v) {
    dialog.innerHTML = `
      <button class="close secondary small" data-close>Close</button>
      <h2 style="margin-top:0">${esc(voter.get(v).name)}</h2>
      ${personHtml(v, v === data.you)}`;
    if (!dialog.open) dialog.showModal();
  }

  // A tap anywhere in a table cell counts as tapping the link inside it.
  const onClick = (e) => {
    const b =
      e.target.closest("button, path[data-voter]") || e.target.closest("td, th")?.querySelector("button[data-pizza], button[data-voter], button[data-person]");
    if (!b) return;
    if (b.dataset.pickMethod) {
      method = b.dataset.pickMethod;
      pickerOpen = false;
      render();
    } else if (b.dataset.cat) {
      cat = b.dataset.cat;
      render();
    } else if (b.dataset.pizza) pizzaDialog(Number(b.dataset.pizza));
    else if (b.dataset.voter) voterDialog(Number(b.dataset.voter));
    else if (b.dataset.person) {
      const v = data.voters.find((x) => x.name === b.dataset.person);
      if (v) voterDialog(v.id);
      else {
        const brought = data.pizzas.filter((p) => p.bringer === b.dataset.person);
        dialog.innerHTML = `
          <button class="close secondary small" data-close>Close</button>
          <h2 style="margin-top:0">${esc(b.dataset.person)}</h2>
          <p>Brought ${brought.map((p) => `<button class="link" data-pizza="${p.id}">${esc(p.restaurant)}</button>`).join(" and ")}.</p>
          <p class="hint">Hasn't scored anything yet.</p>`;
        if (!dialog.open) dialog.showModal();
      }
    }
  };
  root.addEventListener("click", onClick);
  root.addEventListener("toggle", (e) => {
    if (e.target.classList?.contains("method-pick")) pickerOpen = e.target.open;
  }, true);
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

const PALETTE = ["#1f5fd1", "#d22f27", "#8a3ffc", "#e07b00", "#1a9e5a", "#c2187a", "#00838f", "#6d4c41", "#5c6bc0", "#9e9d24", "#ef5350", "#26a69a"];
const colourOf = (id) => PALETTE[(id - 1) % PALETTE.length];

// The number each method ranks by, for the results box.
function valuesFor(a, method) {
  if (method === "average") return new Map(a.ids.map((id) => [id, a.stats.get(id).mean]));
  if (method === "stv") return new Map(a.ids.map((id) => [id, a.rankings.stv.includes(id) ? 3 - a.rankings.stv.indexOf(id) : NaN]));
  return a.values[method] ?? new Map();
}

function fmtValue(method, v) {
  if (!Number.isFinite(v)) return "–";
  if (method === "stv") return ordinal(4 - v);
  if (method === "borda") return `${Math.round(v * 100)}%`;
  if (method === "firsts") return fmt(v, v % 1 ? 1 : 0);
  return fmt(v, 2);
}

// Award cards: a coloured title strip, then the description.
function awards(list) {
  return list
    .map((f) => `<div class="award ${f.wide ? "wide" : ""}" style="--c:${f.colour}"><div class="award-title"><span>${f.icon}</span>${f.title}</div><div class="award-body">${f.body}</div></div>`)
    .join("");
}


// Plain-language facts about the current tab, as award cards.
function funFacts(a, data, voter, pname) {
  const facts = [];
  const link = (id) => `<button class="link" data-pizza="${id}">${pname(id)}</button>`;
  const who = (v) => `<button class="link" data-voter="${v}">${esc(voter.get(v).name)}</button>`;

  const rated = a.ids.filter((id) => a.stats.get(id).n >= 3);
  if (rated.length >= 2) {
    const bySpread = [...rated].sort((x, y) => a.stats.get(y).sd - a.stats.get(x).sd);
    const split = a.stats.get(bySpread[0]);
    const agreed = a.stats.get(bySpread[bySpread.length - 1]);
    facts.push({ icon: "⚡", title: "Most divisive", colour: "#e07b00", body: `${link(bySpread[0])}. Scores ran from ${fmt(Math.min(...split.scores), 1)} to ${fmt(Math.max(...split.scores), 1)}.` });
    facts.push({ icon: "🤝", title: "Most agreed on", colour: "#1a9e5a", body: `${link(bySpread[bySpread.length - 1])}. Almost everyone gave it about ${fmt(agreed.mean, 0)}.` });
  }

  const people = [...a.ballots].filter(([, b]) => b.size >= 3).map(([v, b]) => ({ v, m: avg([...b.values()]) }));
  if (people.length >= 2) {
    people.sort((x, y) => x.m - y.m);
    facts.push({ icon: "🧐", title: "Toughest critic", colour: "#d22f27", body: `${who(people[0].v)}. Averaged ${fmt(people[0].m, 1)}.` });
    facts.push({ icon: "🥰", title: "Easiest to please", colour: "#c2187a", body: `${who(people[people.length - 1].v)}. Averaged ${fmt(people[people.length - 1].m, 1)}.` });
  }

  const league = agreementLeague(data);
  if (league.length >= 3) {
    facts.push({ icon: "🐑", title: "Biggest sheep", colour: "#5c6bc0", body: `${who(league[0].v)}. Scored the most like the room.` });
    facts.push({ icon: "🐺", title: "Lone wolf", colour: "#37474f", body: `${who(league[league.length - 1].v)}. Scored the least like the room.` });
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
    ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((t) => `<text x="${x(t)}" y="64" font-size="8" text-anchor="middle" fill="#8a776a">${t}</text>`).join("")}
    ${dots.join("")}
  </svg>`;
}
