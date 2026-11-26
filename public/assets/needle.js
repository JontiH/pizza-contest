import { ballotsFor, rank, stats } from "./tally.js";

// Win chances from a partial count: the uncounted ballots are filled in by
// resampling counted ballots (with a little noise on each score), the count
// is rerun, and we tally who wins. With nothing counted, everyone is equal.
export function winChances(data, category, countedVoters, totalVoters, method, sims = 300) {
  const { ids } = ballotsFor(data, category);
  const counted = new Set(countedVoters);
  const base = data.scores.filter((o) => counted.has(o.v));
  const pool = [...counted].map((v) => base.filter((o) => o.v === v)).filter((b) => b.some((o) => ids.includes(o.p)));
  const wins = new Map(ids.map((id) => [id, 0]));
  if (!pool.length) {
    for (const id of ids) wins.set(id, 1 / ids.length);
    return wins;
  }
  const missing = Math.max(0, totalVoters - counted.size);
  for (let i = 0; i < sims; i++) {
    const scores = [...base];
    for (let j = 0; j < missing; j++) {
      const ballot = pool[Math.floor(Math.random() * pool.length)];
      const v = `sim${j}`;
      for (const o of ballot) scores.push({ ...o, v, s: clamp(o.s + gauss() * 0.75) });
    }
    const sim = { ...data, scores };
    const { ballots } = ballotsFor(sim, category);
    const winner = rank(method, ids, ballots, stats(ids, ballots), sim)[0];
    wins.set(winner, wins.get(winner) + 1);
  }
  for (const id of ids) wins.set(id, wins.get(id) / sims);
  return wins;
}

const clamp = (s) => Math.min(10, Math.max(0, Math.round(s * 100) / 100));
function gauss() {
  const u = 1 - Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

// A half-dial gauge. The needle twitches around its value until told to
// stop, like the real one did on election night.
export class Needle {
  constructor(el, label) {
    this.value = 0.5;
    el.innerHTML = `
      <svg viewBox="0 0 200 118" class="needle-svg" role="img">
        <defs>
          <linearGradient id="ng-${label}" x1="0" x2="1">
            <stop offset="0" stop-color="#9aa7b8"/><stop offset="0.5" stop-color="#e9e3d6"/><stop offset="1" stop-color="#c8322b"/>
          </linearGradient>
        </defs>
        <path d="M10 108 A90 90 0 0 1 190 108" fill="none" stroke="url(#ng-${label})" stroke-width="22"/>
        ${[0.25, 0.5, 0.75].map((t) => {
          const a = Math.PI * (1 - t);
          return `<line x1="${100 + 70 * Math.cos(a)}" y1="${108 - 70 * Math.sin(a)}" x2="${100 + 101 * Math.cos(a)}" y2="${108 - 101 * Math.sin(a)}" stroke="#fff" stroke-width="1.5"/>`;
        }).join("")}
        <g class="needle-arm"><line x1="100" y1="108" x2="100" y2="22" stroke="#222" stroke-width="3" stroke-linecap="round"/></g>
        <circle cx="100" cy="108" r="7" fill="#222"/>
      </svg>
      <div class="needle-caption"></div>`;
    this.arm = el.querySelector(".needle-arm");
    this.caption = el.querySelector(".needle-caption");
    this.timer = setInterval(() => this.draw(true), 120);
    this.draw(false);
  }
  set(value, caption) {
    this.value = value;
    this.caption.innerHTML = caption;
  }
  draw(jitter) {
    const spread = jitter ? Math.min(this.value, 1 - this.value) * 0.12 : 0;
    const v = Math.min(1, Math.max(0, this.value + (Math.random() - 0.5) * 2 * spread));
    this.arm.style.transform = `rotate(${(v - 0.5) * 180}deg)`;
  }
  stop() {
    clearInterval(this.timer);
    this.draw(false);
  }
}
