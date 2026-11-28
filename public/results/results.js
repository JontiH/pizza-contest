import { mountExplorer } from "/assets/explorer.js";
import { fakeResults, firstScores } from "/assets/fakedata.js";
import { $, api, esc } from "/assets/ui.js";

const root = $("#explorer");

// Logged-in guests get the fuller payload (with who brought what) as soon
// as voting closes; everyone else gets the public one after the reveal.
// ?test shows made-up ballots (on the real lineup when logged in) so the
// host can watch results fill in as votes arrive.
const testSeed = new URLSearchParams(location.search).get("test");

async function load() {
  if (testSeed !== null) return testData(Number(testSeed) || 1);
  try {
    return await api("GET", "/api/results");
  } catch {
    return api("GET", "/pub/results");
  }
}

async function testData(seed) {
  let board = null;
  try {
    board = await api("GET", "/api/board");
  } catch {}
  const lineup = board?.pizzas.length ? board.pizzas : null;
  return { full: fakeResults(seed, lineup, board ? Math.max(12, board.guests.length) : 22), realLineup: !!lineup, test: true };
}

function mountTest({ full, realLineup }) {
  let shown = 0;
  let timer = null;
  const bar = document.createElement("div");
  bar.className = "card preview-note stack";
  root.before(bar);
  const explorer = mountExplorer(root, firstScores(full, 0), { official: "" });

  const draw = () => {
    explorer.update(firstScores(full, shown));
    const voted = new Set(full.scores.slice(0, shown).map((o) => o.v)).size;
    bar.querySelector("[data-count]").textContent = `${shown} of ${full.scores.length} votes in, from ${voted} of ${full.voters.length} guests`;
    bar.querySelector("[data-auto]").textContent = timer ? "Pause" : "Auto-play";
  };
  const add = (n) => {
    shown = Math.min(full.scores.length, Math.max(0, shown + n));
    if (shown === full.scores.length) stop();
    draw();
  };
  const stop = () => {
    clearInterval(timer);
    timer = null;
  };

  bar.innerHTML = `
    <div><strong>Test mode.</strong> ${realLineup ? "Today's real lineup" : "Made-up pizzas"}, made-up guests and votes. Nothing is saved.</div>
    <div data-count class="hint"></div>
    <div class="row">
      <button class="small" data-add="1">+1 vote</button>
      <button class="small" data-add="10">+10</button>
      <button class="small" data-add="${full.voters.length}">+1 round</button>
      <button class="small secondary" data-auto></button>
      <button class="small secondary" data-all>All</button>
      <button class="small link" data-reset>Reset</button>
    </div>
    <div class="hint"><a href="?test=${Math.floor(Math.random() * 1e6) + 2}">New fake votes</a> · <a href="/app/count.html?test">Ballot-by-ballot count</a> · <a href="/app/#admin">Back to Admin</a></div>`;
  bar.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.add) add(Number(b.dataset.add));
    else if (b.hasAttribute("data-all")) add(full.scores.length);
    else if (b.hasAttribute("data-reset")) {
      stop();
      shown = 0;
      draw();
    } else if (b.hasAttribute("data-auto")) {
      if (timer) stop();
      else timer = setInterval(() => add(2), 700);
      draw();
    }
  });
  draw();
}

load()
  .then((data) => {
    if (data.test) return mountTest(data);
    mountExplorer(root, data, { official: data.officialMethod });
    if (data.preview) {
      const note = document.createElement("p");
      note.className = "card preview-note";
      note.textContent = "Admin preview: guests can't see results until you set the phase to Voting closed.";
      root.prepend(note);
    }
  })
  .catch((e) => {
    root.innerHTML = `<p class="empty">${esc(e.status === 404 ? "Results will appear here after the party." : e.message)}</p>`;
  });
