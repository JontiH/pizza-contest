// The pizza guy does the Macarena: 16 beats that loop. Each beat names
// where his hands go; elbows and knees are solved with two-bone IK so the
// limbs bend naturally between poses. Coordinates are in the SVG viewBox
// (240 x 300), body-local before the body transform is applied.

const BPM = 103;
const BEAT_MS = 60000 / BPM;
const BEATS = 16;

const ARM = [44, 44];
const LEG = [38, 38];
const SHOULDER = { a: [82, 128], b: [158, 128] };
const HIP = { a: [111, 214], b: [129, 214] };
const PIVOT = [120, 228];
const FLOOR_Y = 284;
const FEET = { a: [98, FLOOR_Y], b: [142, FLOOR_Y] };

// a = the arm on the viewer's left, b = viewer's right. bend picks which
// side the elbow goes. palm: true shows the palm (after the flip).
const OUT_A = { at: [-4, 124], bend: -1 };
const OUT_B = { at: [244, 124], bend: 1 };
const POSES = [
  /* 1  arm out     */ { a: OUT_A, b: { at: [152, 168], bend: 1 } },
  /* 2  arm out     */ { a: OUT_A, b: OUT_B },
  /* 3  flip palm   */ { a: { ...OUT_A, palm: true }, b: OUT_B },
  /* 4  flip palm   */ { a: { ...OUT_A, palm: true }, b: { ...OUT_B, palm: true } },
  /* 5  to shoulder */ { a: { at: [150, 140], bend: -1 }, b: { ...OUT_B, palm: true } },
  /* 6  to shoulder */ { a: { at: [150, 140], bend: -1 }, b: { at: [90, 146], bend: 1 } },
  /* 7  behind head */ { a: { at: [104, 34], bend: 1 }, b: { at: [90, 146], bend: 1 } },
  /* 8  behind head */ { a: { at: [104, 34], bend: 1 }, b: { at: [136, 34], bend: -1 } },
  /* 9  opposite hip*/ { a: { at: [127, 182], bend: -1 }, b: { at: [136, 34], bend: -1 } },
  /* 10 opposite hip*/ { a: { at: [127, 182], bend: -1 }, b: { at: [113, 188], bend: 1 } },
  /* 11 own hip     */ { a: { at: [101, 176], bend: 1 }, b: { at: [113, 188], bend: 1 } },
  /* 12 own hip     */ { a: { at: [101, 176], bend: 1 }, b: { at: [139, 176], bend: -1 } },
  /* 13 wiggle      */ { a: { at: [101, 176], bend: 1 }, b: { at: [139, 176], bend: -1 }, wiggle: true },
  /* 14 wiggle      */ { a: { at: [101, 176], bend: 1 }, b: { at: [139, 176], bend: -1 }, wiggle: true },
  /* 15 wiggle      */ { a: { at: [101, 176], bend: 1 }, b: { at: [139, 176], bend: -1 }, wiggle: true },
  /* 16 jump, clap  */ { a: { at: [115, 118], bend: -1 }, b: { at: [125, 118], bend: 1 }, jump: true },
];

const lerp = (a, b, t) => a + (b - a) * t;
const lerp2 = (p, q, t) => [lerp(p[0], q[0], t), lerp(p[1], q[1], t)];
// Hit the pose in the first third of the beat, then hold: reads as dancing
// on the beat instead of drifting.
const snap = (f) => (f < 0.34 ? 1 - (1 - f / 0.34) ** 3 : 1);

function ik(s, t, [l1, l2], bend) {
  const dx = t[0] - s[0];
  const dy = t[1] - s[1];
  const d = Math.min(Math.hypot(dx, dy), l1 + l2 - 0.01);
  const theta = Math.atan2(dy, dx);
  const a = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d || 1))));
  const elbow = [s[0] + l1 * Math.cos(theta + bend * a), s[1] + l1 * Math.sin(theta + bend * a)];
  const reach = [s[0] + d * Math.cos(theta), s[1] + d * Math.sin(theta)];
  return { elbow, hand: reach };
}

// Body transform: translate, then rotate and scale X around the pivot.
function bodyMatrix(x, y, r, sx) {
  const c = Math.cos(r);
  const s = Math.sin(r);
  return (p) => {
    const px = (p[0] - PIVOT[0]) * sx;
    const py = p[1] - PIVOT[1];
    return [PIVOT[0] + x + px * c - py * s, PIVOT[1] + y + px * s + py * c];
  };
}

export function mountDancer(svg) {
  const $ = (id) => svg.querySelector(`#${id}`);
  const parts = {
    body: $("body"),
    armA: $("armA"),
    armB: $("armB"),
    handA: $("handA"),
    handB: $("handB"),
    legA: $("legA"),
    legB: $("legB"),
    shoeA: $("shoeA"),
    shoeB: $("shoeB"),
    floor: $("floor"),
    mouth: $("mouth"),
    eyes: [...svg.querySelectorAll(".eye")],
    pupils: [...svg.querySelectorAll(".pupil")],
  };

  function limb(path, s, e, h) {
    path.setAttribute("d", `M${s[0].toFixed(1)} ${s[1].toFixed(1)} Q${e[0].toFixed(1)} ${e[1].toFixed(1)} ${h[0].toFixed(1)} ${h[1].toFixed(1)}`);
  }

  function hand(g, p, palm, flip) {
    g.setAttribute("transform", `translate(${p[0].toFixed(1)} ${p[1].toFixed(1)}) scale(${flip} 1)`);
    g.classList.toggle("palm", !!palm);
  }

  function render(ms) {
    const beat = (((ms / BEAT_MS) % BEATS) + BEATS) % BEATS;
    const i = Math.floor(beat);
    const f = beat - i;
    const from = POSES[(i + BEATS - 1) % BEATS];
    const to = POSES[i];
    const k = snap(f);

    // Groove: a knee bounce on every beat, a sway every two beats.
    let x = Math.sin((beat * Math.PI) / 2) * 4;
    let y = 5 * Math.abs(Math.sin(beat * Math.PI));
    let r = Math.sin((beat * Math.PI) / 2) * 0.05;
    let sx = 1;
    let jump = 0;
    if (to.wiggle) {
      x = Math.sin(beat * Math.PI * 2) * 12;
      r = -Math.sin(beat * Math.PI * 2) * 0.13;
      y = 3 + 3 * Math.abs(Math.sin(beat * Math.PI * 2));
    }
    if (to.jump) {
      jump = Math.sin(f * Math.PI);
      y = -46 * jump;
      // A spin reads in 2D as the body narrowing to edge-on and back.
      sx = Math.cos(f * Math.PI * 2);
      x = 0;
      r = 0;
    }
    const toWorld = bodyMatrix(x, y, r, sx);
    parts.body.setAttribute(
      "transform",
      `translate(${PIVOT[0] + x} ${PIVOT[1] + y}) rotate(${(r * 180) / Math.PI}) scale(${sx} 1) translate(${-PIVOT[0]} ${-PIVOT[1]})`
    );

    for (const side of ["a", "b"]) {
      const A = side === "a";
      const target = lerp2(from[side].at, to[side].at, k);
      const bend = k < 0.5 ? from[side].bend : to[side].bend;
      const { elbow, hand: h } = ik(SHOULDER[side], target, ARM, bend);
      limb(A ? parts.armA : parts.armB, SHOULDER[side], elbow, h);
      hand(A ? parts.handA : parts.handB, h, k < 0.5 ? from[side].palm : to[side].palm, A ? 1 : -1);

      // Feet stay planted except in the jump, when they tuck up under him.
      const hipW = toWorld(HIP[side]);
      const foot = to.jump ? [lerp(FEET[side][0], A ? 108 : 132, jump), FLOOR_Y - 40 * jump - 14 * jump] : FEET[side];
      const knee = ik(hipW, foot, LEG, A ? 1 : -1);
      limb(A ? parts.legA : parts.legB, hipW, knee.elbow, knee.hand);
      (A ? parts.shoeA : parts.shoeB).setAttribute("transform", `translate(${knee.hand[0].toFixed(1)} ${knee.hand[1].toFixed(1)})`);
    }

    parts.floor.setAttribute("rx", (52 - 20 * jump).toFixed(1));
    parts.floor.setAttribute("opacity", (1 - 0.5 * jump).toFixed(2));

    const blinking = ms % 3900 < 130;
    for (const e of parts.eyes) e.setAttribute("ry", blinking ? 1.2 : 9);
    const look = to.wiggle ? Math.sin(beat * Math.PI * 2) * 3 : x * 0.4;
    for (const p of parts.pupils) {
      p.setAttribute("transform", `translate(${look.toFixed(1)} 1)`);
      p.setAttribute("opacity", blinking ? 0 : 1);
    }
    parts.mouth.classList.toggle("open", !!to.jump && f > 0.1 && f < 0.85);
  }

  return { render, loopMs: BEAT_MS * BEATS };
}
