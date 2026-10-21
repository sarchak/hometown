// Generates index.html from one continuous take (assets/clips/take.mp4 + rec/markers.json) and the narration.
// Narration length drives each scene. Each footage scene has an optional "lead" stretch (the agent working) that
// plays sped up (max 4x) so the reveal lands as the voice names it, then a "hold" stretch at 1x.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const dur = (f) => parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${f}"`).toString());
const M = JSON.parse(readFileSync('rec/markers.json', 'utf8'));
const TAKE = 'assets/clips/take.mp4';
const TAKE_DUR = dur(TAKE);
const PAD = 1.3; // air after each narration line

// lead: [from, to] sped up; hold: [from, to] at 1x (to is clamped to what the scene has room for)
const SCENES = [
  { id: 'start', vo: '02-start', pos: 'low', lead: [M.hero + 2.0, M.typed - 0.2], hold: [M.typed - 0.2, M.route + 1.2], label: 'Name the act', line: 'Qloo search resolves it to a real entity.', chips: ['GET /search', 'region', 'stops', 'rooms'] },
  { id: 'markets', vo: '03-markets', pos: 'low', lead: [M.route + 1.2, M.markets - 0.3], hold: [M.markets - 0.3, M.first_stop], label: 'Rank the markets', line: 'One Qloo heatmap per city, in parallel. Scored by affinity rank.', chips: ['filter.type=urn:heatmap', 'signal.interests.entities', '12 cities'] },
  { id: 'city', vo: '04-city', lead: [M.first_stop, M.stop1], hold: [M.stop1, M.crowd_view], label: 'Build the night', line: 'Rooms, openers and pre-show spots, each a Qloo affinity.', chips: ['urn:entity:place', 'filter.location=POINT()', 'urn:entity:artist', 'signal.location.query'] },
  { id: 'crowd', vo: '05-crowd', lead: null, hold: [M.crowd_view, M.memo], label: 'Who shows up', line: 'Age skew, taste tags and the brands this crowd over-indexes on.', chips: ['urn:demographics', 'urn:tag', 'urn:entity:brand'] },
  { id: 'memo', vo: '06-memo', lead: null, hold: [M.memo, M.followup - 3.0], label: 'The memo', line: '"Qloo shows" is measured. "I read this as" is the agent.', chips: ['finalize_tour', 'drivable order', 'every Qloo call logged'] },
  { id: 'followup', vo: '07-followup', holdFrac: 0.45, lead: [M.followup - 3.4, M.followup_done - 0.2], hold: [M.followup_done - 0.2, M.end], label: 'Change your mind', line: 'Swap a city. New Qloo calls, a new route, and an honest push back.', chips: ['Swap Miami for Nashville', 're-ranked', 're-routed'] },
];

const voOpen = dur('assets/vo/00-open.mp3'), voProblem = dur('assets/vo/01-problem.mp3'), voClose = dur('assets/vo/08-close.mp3');
const r1 = (n) => Math.ceil(n * 10) / 10;
const OPEN = r1(voOpen + PAD + 0.8);
const PROBLEM = r1(voProblem + PAD);
let t = OPEN + PROBLEM;
const parts = [], audio = [], tweens = [];

for (const s of SCENES) {
  const voDur = dur(`assets/vo/${s.vo}.mp3`);
  const sceneDur = r1(voDur + PAD);
  let [h0, h1] = s.hold;
  h1 = Math.min(h1, TAKE_DUR - 0.1);
  let holdLen = Math.min(h1 - h0, sceneDur * (s.holdFrac ?? 0.7));
  let leadLen = sceneDur - holdLen; // timeline seconds for the approach
  let leadSrc = s.lead ? s.lead[1] - s.lead[0] : 0;
  let rate = 1;
  if (leadSrc > 0) {
    rate = Math.max(1, Math.min(4, leadSrc / leadLen));
    if (leadSrc / rate > leadLen) s.lead[0] = s.lead[1] - leadLen * rate; // trim the start of the approach
    leadLen = (s.lead[1] - s.lead[0]) / rate;
    holdLen = sceneDur - leadLen;
  } else {
    // no approach: play the stretch slower (down to 0.5x) before reaching further back in the take
    holdLen = sceneDur;
    leadLen = 0;
    if (h1 - h0 < sceneDur * 0.5) h0 = Math.max(0, h1 - sceneDur * 0.5);
  }
  const holdRate = Math.max(0.5, Math.min(1, (h1 - h0) / holdLen)); // a long scene over a short stretch plays slightly slow
  const aStart = t, bStart = t + leadLen;
  parts.push(`
    <!-- ${s.id}: ${sceneDur}s; approach ${leadLen.toFixed(1)}s at ${rate.toFixed(2)}x, then ${holdLen.toFixed(1)}s at ${holdRate.toFixed(2)}x -->
    <div class="shot" id="w-${s.id}">
      ${leadLen > 0 ? `<video id="v-${s.id}-a" class="clip" src="${TAKE}" muted playsinline data-start="${aStart.toFixed(2)}" data-duration="${leadLen.toFixed(2)}" data-media-start="${s.lead[0].toFixed(2)}" data-playback-rate="${rate.toFixed(3)}" data-track-index="1"></video>` : ''}
      <video id="v-${s.id}-b" class="clip" src="${TAKE}" muted playsinline data-start="${bStart.toFixed(2)}" data-duration="${holdLen.toFixed(2)}" data-media-start="${h0.toFixed(2)}"${holdRate < 1 ? ` data-playback-rate="${holdRate.toFixed(3)}"` : ''} data-track-index="1"></video>
    </div>
    <section class="clip lower${s.pos === 'low' ? ' low' : ''}" id="lt-${s.id}" data-start="${(t + 0.3).toFixed(2)}" data-duration="${(sceneDur - 0.3).toFixed(2)}" data-track-index="3">
      <div class="lt-card"><div class="lt-top"><span class="lt-dot"></span><span class="lt-label">${s.label}</span></div><div class="lt-line">${s.line}</div><div class="lt-chips">${s.chips.map((c) => `<span>${c}</span>`).join('')}</div></div>
    </section>`);
  audio.push(`<audio id="vo-${s.id}" src="assets/vo/${s.vo}.mp3" data-start="${(t + 0.35).toFixed(2)}" data-duration="${voDur.toFixed(2)}" data-track-index="4" data-volume="1"></audio>`);
  tweens.push(`tl.fromTo("#lt-${s.id} .lt-card", { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.55, ease: "expo.out" }, ${(t + 0.3).toFixed(2)});
  tl.fromTo("#lt-${s.id} .lt-chips span", { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, stagger: 0.07, ease: "power2.out" }, ${(t + 0.7).toFixed(2)});
  tl.to("#lt-${s.id} .lt-card", { opacity: 0, y: 14, duration: 0.3, ease: "power2.in" }, ${(t + sceneDur - 0.4).toFixed(2)});
  tl.fromTo("#w-${s.id}", { scale: 1.0 }, { scale: 1.03, duration: ${sceneDur.toFixed(2)}, ease: "none" }, ${t.toFixed(2)});`);
  t += sceneDur;
}
const CLOSE_START = t, CLOSE = r1(voClose + PAD + 1.5);
const TOTAL = +(CLOSE_START + CLOSE).toFixed(2);

// Route motif for the open card: five stops across the frame.
const STOPS = [[300, 150], [640, 100], [980, 190], [1320, 90], [1620, 160]];
const routePath = STOPS.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ');
const routeSvg = (prefix) => `<svg class="route" viewBox="0 0 1920 1080" aria-hidden="true">
      <path id="${prefix}-path" d="${routePath}" />
      ${STOPS.map(([x, y], i) => `<g class="stop" id="${prefix}-stop${i + 1}"><circle cx="${x}" cy="${y}" r="26" /><text x="${x}" y="${y + 11}">${i + 1}</text></g>`).join('\n      ')}
    </svg>`;

const html = `<!doctype html>
<html lang="en" data-resolution="landscape">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=1920, height=1080" />
<title>Hometown demo</title>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
  @font-face { font-family: "Barlow Condensed"; src: url("assets/fonts/BarlowCondensed-700.ttf") format("truetype"); font-weight: 700; }
  @font-face { font-family: "Barlow Condensed"; src: url("assets/fonts/BarlowCondensed-600.ttf") format("truetype"); font-weight: 600; }
  @font-face { font-family: "Barlow"; src: url("assets/fonts/Barlow-500.ttf") format("truetype"); font-weight: 500; }
  @font-face { font-family: "Barlow"; src: url("assets/fonts/Barlow-600.ttf") format("truetype"); font-weight: 600; }
  :root { --paper: #EEF0EA; --paper-deep: #E2E5DD; --ink: #14213D; --ink-soft: #4A5570; --route: #D7263D; --tape: #F4D35E; --display: "Barlow Condensed"; --body: "Barlow"; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1920px; height: 1080px; overflow: hidden; background: var(--paper); }
  #root { position: relative; width: 100%; height: 100%; overflow: hidden; background: var(--paper); font-family: var(--body); color: var(--ink); }
  .clip { position: absolute; inset: 0; }
  .shot { position: absolute; inset: 0; transform-origin: 50% 40%; }
  .shot video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .ground { position: absolute; inset: 0; background: var(--paper); }
  .rule { position: absolute; left: 120px; right: 120px; height: 3px; background: var(--ink); }
  .route { position: absolute; inset: 0; width: 100%; height: 100%; }
  .route path { fill: none; stroke: var(--route); stroke-width: 6; stroke-dasharray: 18 14; }
  .route .stop circle { fill: var(--route); stroke: var(--paper); stroke-width: 6; }
  .route .stop text { font: 700 30px var(--display); fill: #fff; text-anchor: middle; }
  .card { position: absolute; left: 120px; right: 120px; top: 0; bottom: 0; display: grid; align-content: center; }
  .wordmark { font: 700 150px/1 var(--display); letter-spacing: -0.01em; }
  .hero { margin-top: 26px; font: 700 76px/1.05 var(--display); max-width: 1500px; }
  .hero em { font-style: normal; color: var(--route); }
  .sub { margin-top: 34px; font: 500 34px/1.35 var(--body); color: var(--ink-soft); max-width: 1200px; }
  .credit { position: absolute; left: 120px; bottom: 80px; font: 600 28px/1.4 var(--display); color: var(--ink-soft); letter-spacing: 0.02em; }
  .lines { display: grid; gap: 34px; max-width: 1560px; }
  .lines .l { font: 700 70px/1.08 var(--display); }
  .lines .l em { font-style: normal; background: linear-gradient(transparent 58%, var(--tape) 58%); }
  .lines .l.quiet { font: 500 46px/1.25 var(--body); color: var(--ink-soft); max-width: 1300px; }
  .tags { display: flex; gap: 12px; margin-top: 50px; flex-wrap: wrap; }
  .tags span { font: 600 28px/1 var(--display); letter-spacing: 0.02em; padding: 14px 18px; border: 3px solid var(--ink); border-radius: 3px; }
  .tags span.hi { background: var(--route); border-color: var(--route); color: #fff; }
  .url { margin-top: 44px; font: 700 54px/1 var(--display); color: var(--route); }
  .lower { pointer-events: none; }
  .lt-card { position: absolute; right: 64px; top: 64px; max-width: 900px; background: var(--paper); color: var(--ink); border: 3px solid var(--ink); border-radius: 3px; padding: 26px 34px 28px; box-shadow: 0 24px 48px rgba(20,33,61,.22); }
  .lower.low .lt-card { top: auto; bottom: 64px; }
  .lt-top { display: flex; align-items: center; gap: 12px; font: 600 28px/1 var(--display); letter-spacing: 0.04em; color: var(--ink-soft); margin-bottom: 10px; }
  .lt-dot { width: 14px; height: 14px; border-radius: 50%; background: var(--route); }
  .lt-line { font: 700 40px/1.15 var(--display); }
  .lt-chips { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }
  .lt-chips span { font: 500 28px/1 var(--body); padding: 9px 12px; border: 2px solid var(--ink); border-radius: 3px; background: #fff; }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="${TOTAL}">

  <!-- Open -->
  <section class="clip" id="open" data-start="0" data-duration="${OPEN}" data-track-index="0">
    <div class="ground"></div>
    ${routeSvg('open')}
    <div class="card">
      <div class="wordmark" id="open-wm">Hometown</div>
      <div class="hero" id="open-h1">Every act has <em>hometowns</em> it has never played.</div>
      <div class="sub" id="open-sub">A tour-routing agent that measures the crowd in Qloo's taste graph, then books the night.</div>
    </div>
    <div class="credit" id="open-credit">Qloo Agentic Hackathon, 2026</div>
  </section>
  <audio id="vo-open" src="assets/vo/00-open.mp3" data-start="0.7" data-duration="${voOpen.toFixed(2)}" data-track-index="4" data-volume="1"></audio>

  <!-- Problem -->
  <section class="clip" id="problem" data-start="${OPEN}" data-duration="${PROBLEM}" data-track-index="0">
    <div class="ground"></div>
    <div class="card">
      <div class="lines">
        <div class="l" id="p-l1">Routing a tour is still <em>guesswork plus streaming counts.</em></div>
        <div class="l quiet" id="p-l2">Streams say where people press play.</div>
        <div class="l" id="p-l3">They do not say which room, which opener, or which brand.</div>
        <div class="tags" id="p-tags"><span class="hi">the room</span><span class="hi">the opener</span><span class="hi">the sponsor</span></div>
      </div>
    </div>
  </section>
  <audio id="vo-problem" src="assets/vo/01-problem.mp3" data-start="${(OPEN + 0.4).toFixed(2)}" data-duration="${voProblem.toFixed(2)}" data-track-index="4" data-volume="1"></audio>

  <!-- Footage scenes -->
  <div class="clip" id="paper" data-start="${(OPEN + PROBLEM).toFixed(2)}" data-duration="${(CLOSE_START - OPEN - PROBLEM).toFixed(2)}" data-track-index="0" style="background:#EEF0EA"></div>
  ${parts.join('\n')}
  ${audio.join('\n  ')}

  <!-- Close -->
  <section class="clip" id="close" data-start="${CLOSE_START.toFixed(2)}" data-duration="${CLOSE}" data-track-index="0">
    <div class="ground"></div>
    ${routeSvg('close')}
    <div class="card">
      <div class="wordmark" id="close-wm">Hometown</div>
      <div class="hero" id="close-h1">Find the rooms that <em>already love you.</em></div>
      <div class="url" id="close-url">hometown.shrikar84.workers.dev</div>
      <div class="tags" id="close-tags"><span class="hi">Qloo heatmaps</span><span class="hi">Qloo insights</span><span class="hi">Qloo tags</span><span>OpenAI tool calling</span><span>Cloudflare Workers</span><span>Open source, MIT</span></div>
    </div>
    <div class="credit" id="close-credit">Built by Shrikar Archak. github.com/sarchak/hometown</div>
  </section>
  <audio id="vo-close" src="assets/vo/08-close.mp3" data-start="${(CLOSE_START + 0.5).toFixed(2)}" data-duration="${voClose.toFixed(2)}" data-track-index="4" data-volume="1"></audio>
</div>
<script>
  const tl = gsap.timeline({ paused: true });
  const drawRoute = (p, at, t0) => {
    // A left-to-right wipe keeps the dashes; the stops land as the wipe reaches them (x = 300..1620 of 1920).
    tl.set(p + "-path", { clipPath: "inset(0 100% 0 0)" }, t0);
    tl.to(p + "-path", { clipPath: "inset(0 0% 0 0)", duration: 1.6, ease: "none" }, at);
    for (let i = 1; i <= 5; i++) tl.fromTo(p + "-stop" + i, { scale: 0, opacity: 0, transformOrigin: "50% 50%" }, { scale: 1, opacity: 1, duration: 0.45, ease: "back.out(1.4)", immediateRender: true }, at + 0.1 + (i - 1) * 0.33);
  };
  // Open
  tl.fromTo("#open-wm", { opacity: 0, filter: "blur(8px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.2, ease: "power4.out" }, 0.25);
  tl.fromTo("#open-h1", { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: "expo.out" }, 0.6);
  tl.fromTo("#open-sub", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power2.out" }, 1.3);
  drawRoute("#open", 3.4, 0);
  tl.fromTo("#open-credit", { opacity: 0 }, { opacity: 1, duration: 0.5 }, 8.0);
  tl.to("#open .card, #open .credit, #open .route", { opacity: 0, duration: 0.3, ease: "power2.in" }, ${(OPEN - 0.35).toFixed(2)});
  // Problem: each line lands on its cue
  tl.fromTo("#p-l1", { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: "expo.out" }, ${(OPEN + 0.3).toFixed(2)});
  tl.fromTo("#p-l2", { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: "expo.out" }, ${(OPEN + 4.0).toFixed(2)});
  tl.fromTo("#p-l3", { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: "expo.out" }, ${(OPEN + 6.6).toFixed(2)});
  tl.fromTo("#p-tags span", { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, stagger: 0.85, ease: "power3.out" }, ${(OPEN + 8.6).toFixed(2)});
  tl.to("#problem .card", { opacity: 0, duration: 0.3, ease: "power2.in" }, ${(OPEN + PROBLEM - 0.35).toFixed(2)});
  // Scenes
  ${tweens.join('\n  ')}
  // Close
  tl.fromTo("#close-wm", { opacity: 0, filter: "blur(8px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.2, ease: "power4.out" }, ${(CLOSE_START + 0.25).toFixed(2)});
  tl.fromTo("#close-h1", { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: "expo.out" }, ${(CLOSE_START + 0.6).toFixed(2)});
  tl.fromTo("#close-url", { opacity: 0 }, { opacity: 1, duration: 0.5 }, ${(CLOSE_START + 1.4).toFixed(2)});
  tl.fromTo("#close-tags span", { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, stagger: 0.07, ease: "power3.out" }, ${(CLOSE_START + 2.0).toFixed(2)});
  drawRoute("#close", ${(CLOSE_START + 4.2).toFixed(2)}, ${CLOSE_START.toFixed(2)});
  tl.fromTo("#close-credit", { opacity: 0 }, { opacity: 1, duration: 0.5 }, ${(CLOSE_START + 7.0).toFixed(2)});
  window.__timelines["main"] = tl;
  tl.seek(0);
</script>
</body>
</html>
`;
writeFileSync('index.html', html);
console.log(`index.html written: total ${TOTAL}s (open ${OPEN}s, problem ${PROBLEM}s, close ${CLOSE}s, take ${TAKE_DUR.toFixed(1)}s)`);
