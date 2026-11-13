// The pizza guy's dances. A routine maps a beat position to a pose: where
// each hand goes, how the body sways, where the feet are. Elbows and knees
// are solved with two-bone IK so limbs bend naturally between poses.
// Coordinates are in the SVG viewBox (240 x 300), body-local before the
// body transform.

const ARM = [44, 44];
const LEG = [38, 38];
const SHOULDER = { a: [82, 128], b: [158, 128] };
const HIP = { a: [111, 214], b: [129, 214] };
const PIVOT = [120, 228];
const FLOOR_Y = 284;
const FEET = { a: [98, FLOOR_Y], b: [142, FLOOR_Y] };

const lerp = (a, b, t) => a + (b - a) * t;
const lerp2 = (p, q, t) => [lerp(p[0], q[0], t), lerp(p[1], q[1], t)];
const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.max(0, Math.min(1, t));
// Hit the pose in the first third of the beat, then hold.
const snap = (f) => (f < 0.34 ? 1 - (1 - f / 0.34) ** 3 : 1);

const STILL = { x: 0, y: 0, r: 0, sx: 1, feet: FEET, mouth: "smile", look: 0, lift: 0 };

function blend(p, q, t) {
  if (t <= 0) return p;
  if (t >= 1) return q;
  const hand = (h, k) => ({ ...(t < 0.5 ? h : k), at: lerp2(h.at, k.at, t) });
  return {
    a: hand(p.a, q.a),
    b: hand(p.b, q.b),
    x: lerp(p.x, q.x, t),
    y: lerp(p.y, q.y, t),
    r: lerp(p.r, q.r, t),
    sx: lerp(p.sx, q.sx, t),
    feet: { a: lerp2(p.feet.a, q.feet.a, t), b: lerp2(p.feet.b, q.feet.b, t) },
    mouth: t < 0.5 ? p.mouth : q.mouth,
    look: lerp(p.look, q.look, t),
    lift: lerp(p.lift, q.lift, t),
  };
}

// ---------- The Carlton ----------
// Side-to-side two-step with hips leading and bent arms swinging the other
// way, a double-time section with a shoulder shimmy, then the "It's not
// unusual" point to the sky. 16 beats.

function carltonSwing(beat, speed, amp, height) {
  const c = Math.cos(Math.PI * beat * speed);
  const v = Math.sin(Math.PI * beat * speed);
  const x = -14 * amp * c;
  // Arms swing opposite the hips and rise at each end of the swing.
  const hx = 46 * amp * c;
  const hy = height - 30 * c * c;
  const lead = v > 0 ? "b" : "a";
  const lift = 10 * Math.abs(v) * amp;
  return {
    a: { at: [100 + hx, hy], bend: 1 },
    b: { at: [140 + hx, hy], bend: -1 },
    x,
    y: 4 * Math.abs(v),
    r: 0.2 * amp * v,
    sx: 1,
    feet: {
      a: [FEET.a[0] + x * 0.9, FLOOR_Y - (lead === "a" ? lift : 0)],
      b: [FEET.b[0] + x * 0.9, FLOOR_Y - (lead === "b" ? lift : 0)],
    },
    mouth: "grin",
    look: -c * 3,
    lift: 0,
  };
}

function carltonPoint(beat) {
  const s = Math.sin((Math.PI * beat) / 2);
  const bob = Math.abs(Math.sin(Math.PI * beat));
  return {
    a: { at: [101, 178], bend: 1 },
    b: { at: [168, 46], bend: -1, point: true },
    x: 7 * s,
    y: 4 * bob,
    r: -0.12 + 0.06 * s,
    sx: 1,
    feet: { a: [FEET.a[0] + 4 * s, FLOOR_Y], b: [FEET.b[0] + 4 * s, FLOOR_Y - 6 * bob] },
    mouth: "o",
    look: 4,
    lift: 1,
  };
}

export const CARLTON = {
  name: "the Carlton",
  bpm: 118,
  beats: 16,
  pose(beat) {
    const A = carltonSwing(beat, 1, 1, 168);
    const B = carltonSwing(beat, 2, 0.7, 176);
    const C = carltonPoint(beat);
    if (beat < 7.5) return A;
    if (beat < 8) return blend(A, B, smooth((beat - 7.5) / 0.5));
    if (beat < 11.5) return B;
    if (beat < 12) return blend(B, C, smooth((beat - 11.5) / 0.5));
    if (beat < 15.5) return C;
    return blend(C, carltonSwing(0, 1, 1, 168), smooth((beat - 15.5) / 0.5));
  },
};

// ---------- The Macarena ----------

const OUT_A = { at: [-4, 124], bend: -1 };
const OUT_B = { at: [244, 124], bend: 1 };
const HIP_A = { at: [101, 176], bend: 1 };
const HIP_B = { at: [139, 176], bend: -1 };
const MAC = [
  { a: OUT_A, b: { at: [152, 168], bend: 1 } },
  { a: OUT_A, b: OUT_B },
  { a: { ...OUT_A, palm: true }, b: OUT_B },
  { a: { ...OUT_A, palm: true }, b: { ...OUT_B, palm: true } },
  { a: { at: [150, 140], bend: -1 }, b: { ...OUT_B, palm: true } },
  { a: { at: [150, 140], bend: -1 }, b: { at: [90, 146], bend: 1 } },
  { a: { at: [104, 34], bend: 1 }, b: { at: [90, 146], bend: 1 } },
  { a: { at: [104, 34], bend: 1 }, b: { at: [136, 34], bend: -1 } },
  { a: { at: [127, 182], bend: -1 }, b: { at: [136, 34], bend: -1 } },
  { a: { at: [127, 182], bend: -1 }, b: { at: [113, 188], bend: 1 } },
  { a: HIP_A, b: { at: [113, 188], bend: 1 } },
  { a: HIP_A, b: HIP_B },
  { a: HIP_A, b: HIP_B, wiggle: true },
  { a: HIP_A, b: HIP_B, wiggle: true },
  { a: HIP_A, b: HIP_B, wiggle: true },
  { a: { at: [115, 118], bend: -1 }, b: { at: [125, 118], bend: 1 }, jump: true },
];

export const MACARENA = {
  name: "the Macarena",
  bpm: 103,
  beats: 16,
  pose(beat) {
    const i = Math.floor(beat);
    const f = beat - i;
    const from = MAC[(i + 15) % 16];
    const to = MAC[i];
    const k = snap(f);
    const hand = (side) => ({ ...(k < 0.5 ? from[side] : to[side]), at: lerp2(from[side].at, to[side].at, k) });
    const p = { ...STILL, a: hand("a"), b: hand("b"), feet: { ...FEET } };
    p.x = Math.sin((beat * Math.PI) / 2) * 4;
    p.y = 5 * Math.abs(Math.sin(beat * Math.PI));
    p.r = Math.sin((beat * Math.PI) / 2) * 0.05;
    p.look = p.x * 0.4;
    if (to.wiggle) {
      p.x = Math.sin(beat * Math.PI * 2) * 12;
      p.r = -Math.sin(beat * Math.PI * 2) * 0.13;
      p.y = 3 + 3 * Math.abs(Math.sin(beat * Math.PI * 2));
      p.look = p.x * 0.25;
    }
    if (to.jump) {
      const j = Math.sin(f * Math.PI);
      p.y = -46 * j;
      // A spin reads in 2D as the body narrowing to edge-on and back.
      p.sx = Math.cos(f * Math.PI * 2);
      p.x = 0;
      p.r = 0;
      p.lift = j;
      p.feet = { a: [lerp(FEET.a[0], 108, j), FLOOR_Y - 54 * j], b: [lerp(FEET.b[0], 132, j), FLOOR_Y - 54 * j] };
      if (f > 0.1 && f < 0.85) p.mouth = "o";
    }
    return p;
  },
};

// ---------- Rig ----------

function ik(s, t, [l1, l2], bend) {
  const dx = t[0] - s[0];
  const dy = t[1] - s[1];
  const d = Math.min(Math.hypot(dx, dy), l1 + l2 - 0.01);
  const theta = Math.atan2(dy, dx);
  const a = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d || 1))));
  return {
    joint: [s[0] + l1 * Math.cos(theta + bend * a), s[1] + l1 * Math.sin(theta + bend * a)],
    end: [s[0] + d * Math.cos(theta), s[1] + d * Math.sin(theta)],
  };
}

function bodyMatrix(x, y, r, sx) {
  const c = Math.cos(r);
  const s = Math.sin(r);
  return (p) => {
    const px = (p[0] - PIVOT[0]) * sx;
    const py = p[1] - PIVOT[1];
    return [PIVOT[0] + x + px * c - py * s, PIVOT[1] + y + px * s + py * c];
  };
}

const f1 = (n) => n.toFixed(1);

export function mountDancer(svg, routine = CARLTON) {
  const $ = (id) => svg.querySelector(`#${id}`);
  const parts = {
    body: $("body"),
    arm: { a: $("armA"), b: $("armB") },
    hand: { a: $("handA"), b: $("handB") },
    leg: { a: $("legA"), b: $("legB") },
    shoe: { a: $("shoeA"), b: $("shoeB") },
    floor: $("floor"),
    mouth: $("mouth"),
    eyes: [...svg.querySelectorAll(".eye")],
    pupils: [...svg.querySelectorAll(".pupil")],
  };
  const beatMs = 60000 / routine.bpm;
  const limb = (path, s, j, e) => path.setAttribute("d", `M${f1(s[0])} ${f1(s[1])} Q${f1(j[0])} ${f1(j[1])} ${f1(e[0])} ${f1(e[1])}`);

  function render(ms) {
    const beat = (((ms / beatMs) % routine.beats) + routine.beats) % routine.beats;
    const p = routine.pose(beat);
    const toWorld = bodyMatrix(p.x, p.y, p.r, p.sx);
    parts.body.setAttribute(
      "transform",
      `translate(${f1(PIVOT[0] + p.x)} ${f1(PIVOT[1] + p.y)}) rotate(${f1((p.r * 180) / Math.PI)}) scale(${p.sx.toFixed(3)} 1) translate(${-PIVOT[0]} ${-PIVOT[1]})`
    );

    for (const side of ["a", "b"]) {
      const h = p[side];
      const arm = ik(SHOULDER[side], h.at, ARM, h.bend);
      limb(parts.arm[side], SHOULDER[side], arm.joint, arm.end);
      // Gloves turn with the forearm so a pointing finger follows the arm.
      const fore = (Math.atan2(arm.end[1] - arm.joint[1], arm.end[0] - arm.joint[0]) * 180) / Math.PI + 90;
      parts.hand[side].setAttribute(
        "transform",
        `translate(${f1(arm.end[0])} ${f1(arm.end[1])}) rotate(${f1(fore)}) scale(${side === "a" ? 1 : -1} 1)`
      );
      parts.hand[side].classList.toggle("palm", !!h.palm);
      parts.hand[side].classList.toggle("point", !!h.point);

      const knee = ik(toWorld(HIP[side]), p.feet[side], LEG, side === "a" ? 1 : -1);
      limb(parts.leg[side], toWorld(HIP[side]), knee.joint, knee.end);
      parts.shoe[side].setAttribute("transform", `translate(${f1(knee.end[0])} ${f1(knee.end[1])})`);
    }

    const air = Math.max(0, -p.y) / 46;
    parts.floor.setAttribute("rx", f1(52 - 20 * air));
    parts.floor.setAttribute("opacity", (1 - 0.5 * air).toFixed(2));

    const blinking = ms % 3900 < 130;
    for (const e of parts.eyes) e.setAttribute("ry", blinking ? 1.2 : 9);
    const lookY = p.lift ? -2.5 : 1;
    for (const pu of parts.pupils) {
      pu.setAttribute("transform", `translate(${f1(p.look)} ${lookY})`);
      pu.setAttribute("opacity", blinking ? 0 : 1);
    }
    parts.mouth.dataset.shape = p.mouth;
  }

  return { render, loopMs: beatMs * routine.beats, name: routine.name };
}
