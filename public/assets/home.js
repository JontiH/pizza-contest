import { MEDLEY, mountDancer } from "/assets/dancer.js";

const dancer = mountDancer(document.getElementById("guy"), MEDLEY);
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Tests and the GIF export drive the dance frame by frame.
window.__dance = dancer;

if (still) {
  dancer.render(0);
} else {
  const start = performance.now();
  const frame = (now) => {
    if (!window.__dancePaused) dancer.render(now - start);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

fetch("/pub/info")
  .then((r) => r.json())
  .then((info) => {
    if (info.revealed) document.getElementById("results-link").hidden = false;
  })
  .catch(() => {});
