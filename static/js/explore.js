// A deterministic block illustration of region selection, not model inference.
// Canvas projects actual block coordinates; context coordinates never change.
(() => {
  'use strict';
  const root = document.querySelector('[data-explorer]');
  if (!root) return;
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const scene = root.querySelector('.explore-scene');
  const meta = root.querySelector('.explore-meta');
  const play = root.querySelector('[data-demo-play]');
  const slider = root.querySelector('#demo-progress');
  const percent = root.querySelector('[data-demo-percent]');
  const status = root.querySelector('[data-demo-status]');
  const caseBar = root.querySelector('.explore-cases');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const brand = getComputedStyle(document.documentElement);
  const blue = brand.getPropertyValue('--navy').trim();
  const orange = brand.getPropertyValue('--orange').trim();
  const shade = (hex, toward, amount) => '#' + [1,3,5].map(i => Math.round(parseInt(hex.slice(i,i+2),16)*(1-amount)+toward*amount).toString(16).padStart(2,'0')).join('');
  const COLORS = {
    context: [shade(blue,255,.14),shade(blue,0,.17),blue],
    selected: [shade(orange,255,.15),shade(orange,0,.18),orange],
  };
  // Shared canonical house: 7 x 7 footprint and 7 blocks high (a cubic bbox).
  const body = [], roof = [];
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
    for (let y = 0; y < 3; y++) {
      if (Math.abs(x) !== 3 && Math.abs(z) !== 3) continue;
      if (z === 3 && (x === 0 && y < 2 || Math.abs(x) === 2 && y === 1)) continue;
      body.push({ x, y, z, part: 'body' });
    }
    for (let y = 3; y <= 6 - Math.abs(x); y++) roof.push({ x, y, z, part: 'roof' });
  }
  const house = [...body, ...roof];
  const flatRoof = [];
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) flatRoof.push({ x, y: 3, z, part: 'roof' });
  for (let y = 4; y <= 5; y++) flatRoof.push({ x: 2, y, z: 0, part: 'roof' });
  const porch = body.filter((b) => Math.abs(b.x) <= 1 && b.z === 3);
  for (let z = 4; z <= 5; z++) for (let x = -1; x <= 1; x++) {
    porch.push({ x, y: 2, z, part: 'entrance' });
    if (Math.abs(x) === 1) for (let y = 0; y < 2; y++) porch.push({ x, y, z, part: 'entrance' });
  }
  const extension = body.filter((b) => b.x === 3 && Math.abs(b.z) <= 1);
  for (let x = 4; x <= 5; x++) for (let z = -1; z <= 1; z++) for (let y = 0; y < 3; y++) {
    if (y === 2 || x === 5 || Math.abs(z) === 1) extension.push({ x, y, z, part: 'extension' });
  }
  const EXAMPLES = {
    gen: [{ label: 'House', prompt: 'A small house with a pitched roof.',
      includes: () => true, target: house, lo: [-3.5,-.5,-3.5], hi: [3.5,6.5,3.5], selection: 'Full region' }],
    edit: [
      { label: 'Roof', prompt: 'A small house with a flat roof and a chimney.',
        edit: { prefix: 'A small house with a ', removed: 'pitched roof', added: 'flat roof and a chimney', suffix: '.' },
        includes: b => b.y >= 3, target: flatRoof, lo: [-3.5,2.5,-3.5], hi: [3.5,6.5,3.5], selection: 'Target region: roof' },
      { label: 'Entrance', prompt: 'A small house with a pitched roof and a covered porch.',
        edit: { prefix: 'A small house with a pitched roof', added: ' and a covered porch', suffix: '.' },
        includes: b => b.z === 3 && Math.abs(b.x) <= 1 && b.y < 3, target: porch,
        lo: [-1.5,-.5,2.5], hi: [1.5,2.5,5.5], selection: 'Target region: entrance' },
      { label: 'Extension', prompt: 'A small house with a pitched roof and a side room.',
        edit: { prefix: 'A small house with a pitched roof', added: ' and a side room', suffix: '.' },
        includes: b => b.x === 3 && Math.abs(b.z) <= 1 && b.y < 3, target: extension,
        lo: [2.5,-.5,-1.5], hi: [5.5,2.5,1.5], selection: 'Target region: side wall' },
    ],
    comp: [
      { label: 'Roof', includes: b => b.y >= 3, lo: [-3.5,2.5,-3.5], hi: [3.5,6.5,3.5], selection: 'Missing region: roof' },
      { label: 'Corner', includes: b => b.x >= 1 && b.z >= 1, lo: [.5,-.5,.5], hi: [3.5,5.5,3.5], selection: 'Missing region: front corner' },
      { label: 'Half house', includes: b => b.x >= 0, lo: [-.5,-.5,-3.5], hi: [3.5,6.5,3.5], selection: 'Missing region: right half' },
    ].map(c => ({ ...c, prompt: 'A small house with a pitched roof.' })),
  };
  let task = 'gen', exampleIndex = 0, progress = 0, running = false;
  let angle = .62, frame = 0, width = 0, height = 0, cameraScale = 0, cameraY = 0;
  let context = [], selected = [], original = [], bounds, example;
  const showMask = true;
  let rotating = !reducedMotion.matches, visible = false, lastTick = 0;
  let lastStatus = '';
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const noise = (i, n) => {
    const x = Math.sin(i * 127.1 + n * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };

  function setup() {
    running = false;
    progress = 0;
    root.dataset.active = task;
    example = EXAMPLES[task][exampleIndex];
    context = house.filter(b => !example.includes(b));
    original = task === 'edit' ? house.filter(example.includes) : [];
    selected = task === 'comp' ? house.filter(example.includes) : example.target;
    bounds = { lo: example.lo, hi: example.hi };
    root.querySelectorAll('[data-demo-task]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.demoTask === task)));
    caseBar.hidden = task === 'gen';
    root.querySelectorAll('[data-demo-case]').forEach((b, i) => {
      b.textContent = EXAMPLES[task][i]?.label || '';
      b.setAttribute('aria-pressed', String(i === exampleIndex));
    });
    const prompt = root.querySelector('[data-demo-prompt]');
    if (task === 'edit') {
      const change = example.edit;
      prompt.replaceChildren(document.createTextNode(`“${change.prefix.trimEnd()}`));
      if (change.removed) {
        const removed = document.createElement('del');
        removed.textContent = change.removed;
        prompt.append(document.createTextNode(' '), removed);
      }
      const added = document.createElement('ins');
      added.textContent = change.added.trim();
      prompt.append(document.createTextNode(' '), added, document.createTextNode(`${change.suffix}”`));
    } else prompt.textContent = `“${example.prompt}”`;
    resize();
    update();
  }

  function update() {
    slider.value = String(Math.round(progress * 100));
    slider.style.setProperty('--demo-progress', `${progress * 100}%`);
    percent.textContent = `${Math.round(progress * 100)}%`;
    play.textContent = running ? 'Pause' : progress >= 1 ? 'Replay' : progress > 0 ? 'Continue' : 'Synthesize';
    root.querySelector('[data-demo-input]').setAttribute('aria-pressed', String(progress === 0));
    root.querySelector('[data-demo-result]').setAttribute('aria-pressed', String(progress === 1));
    const message = progress === 0 ? `${example.selection} selected.`
      : progress < 1 ? 'Synthesizing only the selected region.'
      : task === 'gen' ? 'Full region synthesized.' : 'Selected region synthesized. Everything else reused unchanged.';
    if (message !== lastStatus) { status.textContent = message; lastStatus = message; }
    canvas.setAttribute('aria-description', `${task}. ${example.prompt} ${message}`);
    draw();
    animate();
  }

  // One loop serves synthesis and optional rotation, and stops outside the viewport.
  function animate() {
    if (!visible && (running || rotating)) {
      const rect = root.getBoundingClientRect();
      visible = rect.bottom > 0 && rect.top < window.innerHeight && rect.width > 0;
    }
    if (frame || !visible || document.hidden || (!running && !rotating)) return;
    lastTick = performance.now();
    frame = requestAnimationFrame(tick);
  }
  function tick(now) {
    frame = 0;
    const elapsed = Math.max(0, Math.min(now - lastTick, 80));
    lastTick = now;
    if (running) { progress = clamp(progress + elapsed / 4200, 0, 1); if (progress >= 1) running = false; }
    if (rotating && !pointer) angle += elapsed * .00018;
    if (running || progress === 1 && play.textContent === 'Pause') update();
    else { draw(); animate(); }
  }

  function project(x, y, z) {
    const side = x * Math.cos(angle) - z * Math.sin(angle);
    const depth = x * Math.sin(angle) + z * Math.cos(angle);
    return [width / 2 + side * cameraScale, cameraY + (depth * .48 - y * .88) * cameraScale];
  }

  function polygon(points, fill, stroke, dash = []) {
    ctx.beginPath();
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath();
    ctx.setLineDash(dash);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
    ctx.setLineDash([]);
  }

  function cube(block) {
    const { x, y, z, size = .91, palette, part } = block;
    const s = size / 2;
    const corners = [
      [x - s, y - s, z - s], [x + s, y - s, z - s],
      [x + s, y - s, z + s], [x - s, y - s, z + s],
      [x - s, y + s, z - s], [x + s, y + s, z - s],
      [x + s, y + s, z + s], [x - s, y + s, z + s],
    ].map((v) => project(...v));
    const faces = [
      [Math.cos(angle) >= 0 ? [3, 2, 6, 7] : [0, 1, 5, 4], palette[1]],
      [Math.sin(angle) >= 0 ? [1, 2, 6, 5] : [0, 3, 7, 4], palette[2]],
      [[4, 5, 6, 7], palette[0]],
    ];
    for (const [indices, color] of faces) {
      const points = indices.map((i) => corners[i]);
      polygon(points, color, '#ffffff24');
    }
  }

  function draw() {
    if (!width || !height) return;
    ctx.clearRect(0, 0, width, height);
    // A neutral floor is outside the illustrated asset.
    polygon([[-6, -.62, -6], [6, -.62, -6], [6, -.62, 6], [-6, -.62, 6]].map((p) => project(...p)), '#dce3e8', '#cad4dc');
    const blocks = context.map((b) => ({ ...b, palette: COLORS.context }));
    if (progress === 0) {
      blocks.push(...original.map((b) => ({ ...b, palette: COLORS.context })));
    } else {
      // Noise stays within the selection. Interpolation is deterministic when scrubbing.
      const eased = 1 - Math.pow(1 - progress, 2);
      selected.forEach((b, i) => {
        const coords = ['x', 'y', 'z'].map((axis, n) => {
          const low = bounds.lo[n] + .48, high = bounds.hi[n] - .48;
          const random = low + noise(i + 1, n + 1) * (high - low);
          return random * (1 - eased) + b[axis] * eased;
        });
        blocks.push({ x: coords[0], y: coords[1], z: coords[2], part: b.part,
          size: .24 + .67 * eased, palette: COLORS.selected });
      });
    }
    blocks.sort((a, b) => {
      const depth = (v) => (v.x * Math.sin(angle) + v.z * Math.cos(angle)) * .88 + v.y * .48;
      return depth(a) - depth(b);
    }).forEach(cube);
    if (showMask) {
      const [x0,y0,z0] = bounds.lo, [x1,y1,z1] = bounds.hi;
      const corners = [[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],
        [x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]].map(p => project(...p));
      // A translucent gray selection volume, matching the paper's region mask.
      for (const face of [[4,5,6,7], Math.cos(angle)>=0?[3,2,6,7]:[0,1,5,4], Math.sin(angle)>=0?[1,2,6,5]:[0,3,7,4]]) {
        polygon(face.map(i => corners[i]), '#6b778b26', '#657083b3');
      }
    }
  }

  function resize() {
    const rect = scene.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    // Fit the square ground and every house variant over a complete rotation.
    // The prompt/legend and the controls each have their own reserved space.
    const top = scene.contains(meta) ? meta.offsetTop + meta.getBoundingClientRect().height + 18 : 18;
    const availableHeight = Math.max(0, height - top - 18);
    cameraScale = Math.max(0, Math.min((width - 32) / 17, availableHeight / 12.8));
    cameraY = top + (availableHeight - 12.8 * cameraScale) / 2 + 8.1 * cameraScale;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw();
  }

  let pointer = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, angle, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointer || pointer.id !== e.pointerId) return;
    const delta = e.clientX - pointer.x;
    pointer.moved ||= Math.hypot(delta, e.clientY - pointer.y) > 5;
    if (pointer.moved) { angle = pointer.angle + delta * .012; draw(); }
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!pointer || pointer.id !== e.pointerId) return;
    pointer = null;
  });
  canvas.addEventListener('pointercancel', () => { pointer = null; });
  canvas.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault(); angle += e.key === 'ArrowLeft' ? -.12 : .12; draw();
    }
  });
  root.querySelectorAll('[data-demo-task]').forEach(b => b.addEventListener('click', () => {
    task = b.dataset.demoTask; exampleIndex = 0; setup();
  }));
  root.querySelectorAll('[data-demo-case]').forEach(b => b.addEventListener('click', () => {
    exampleIndex = Number(b.dataset.demoCase); setup();
  }));
  function setProgress(value) { running = false; progress = value; update(); }
  slider.addEventListener('input', () => setProgress(Number(slider.value) / 100));
  root.querySelector('[data-demo-input]').addEventListener('click', () => setProgress(0));
  root.querySelector('[data-demo-result]').addEventListener('click', () => setProgress(1));
  reducedMotion.addEventListener('change', () => { rotating = !reducedMotion.matches; animate(); });
  play.addEventListener('click', () => {
    if (running) { running = false; update(); return; }
    if (reducedMotion.matches) { setProgress(1); return; }
    if (progress >= 1) progress = 0;
    running = true; update();
  });
  function suspend() {
    running = false;
    cancelAnimationFrame(frame); frame = 0;
    update();
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) suspend(); else animate();
  });
  new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1].isIntersecting;
    if (!visible) suspend(); else animate();
  }).observe(root);
  const layoutObserver = new ResizeObserver(resize);
  layoutObserver.observe(scene);
  layoutObserver.observe(meta);
  setup();
  resize();
})();
