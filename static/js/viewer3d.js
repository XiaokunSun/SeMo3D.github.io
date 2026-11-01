// SeMo3D 项目页 · 交互式 3D 查看器（three.js r170，本地 vendor）
// 一个 <canvas> 按网格切成若干窗格（pane），所有窗格共用同一个相机和 OrbitControls，
// 因此 “Source / SeMo3D”、多个变体等结果的旋转与缩放完全同步。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const DRACO_PATH = new URL('../vendor/three/examples/jsm/libs/draco/gltf/', import.meta.url).href;

const COLOR = {
  point: 0xd9483b,    // 稀疏点条件：与论文插图一致的红色小球
  cloud: 0x8d97a2,    // 残缺输入点云
  mask: 0x8f9baa,     // 编辑区域：半透明灰色体
  maskEdge: 0x56626f,
};

const ICON = {
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  rotate: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"/></svg>',
  reset: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/><circle cx="12" cy="12" r="2"/></svg>',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let sharedLoader = null;
function getLoader() {
  if (!sharedLoader) {
    const draco = new DRACOLoader();
    draco.setDecoderPath(DRACO_PATH);
    sharedLoader = new GLTFLoader();
    sharedLoader.setDRACOLoader(draco);
  }
  return sharedLoader;
}

let dotTexture = null;
function getDotTexture() {
  if (!dotTexture) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(32, 32, 30, 0, Math.PI * 2);
    g.fill();
    dotTexture = new THREE.CanvasTexture(c);
  }
  return dotTexture;
}

// 点云 .bin 格式：6 个 float32（xyz 最小值、最大值）+ N×3 个 uint16 量化坐标
async function fetchCloud(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const buf = await res.arrayBuffer();
  const head = new Float32Array(buf, 0, 6);
  const q = new Uint16Array(buf, 24);
  const pos = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) {
    const a = i % 3;
    pos[i] = head[a] + (q[i] / 65535) * (head[a + 3] - head[a]);
  }
  return pos;
}

function makeSpheres(points, { radius = 0.013, xray = false } = {}) {
  const n = points.length / 3;
  const mat = new THREE.MeshStandardMaterial({ color: COLOR.point, roughness: 0.42, metalness: 0 });
  if (xray) {
    // 叠加到网格上时透视显示，所有点都看得见
    mat.depthTest = false;
    mat.transparent = true;
    mat.opacity = 0.92;
  }
  const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(radius, 18, 12), mat, n);
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    m.makeTranslation(points[3 * i], points[3 * i + 1], points[3 * i + 2]);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  if (xray) mesh.renderOrder = 20;
  return mesh;
}

function makeCloud(positions, { size = 0.012, color = COLOR.cloud, onSurface = false } = {}) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.computeBoundingSphere();
  const mat = new THREE.PointsMaterial({ size, color, map: getDotTexture(), alphaTest: 0.5, toneMapped: false });
  if (onSurface) {
    // 叠加在网格表面时把点沿视线轻微前移，避免与表面深度冲突
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n\tgl_Position.z -= 0.004 * gl_Position.w;',
      );
    };
  }
  return new THREE.Points(geo, mat);
}

function disposeObject(root) {
  root?.traverse((o) => {
    o.geometry?.dispose();
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      for (const k of Object.keys(m)) {
        const v = m[k];
        if (v && v.isTexture && v !== dotTexture) v.dispose();
      }
      m.dispose();
    }
  });
}

export class Viewer {
  constructor(options = {}) {
    this.opts = {
      autoRotate: true,
      rotateSpeed: 2.6,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      preserveDrawingBuffer: false,
      toolbarHeight: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--viewer-toolbar-height')) || 48,
      paneHeaderHeight: 0,
      paneGap: 0,
      fitBox: false,
      hint: 'Drag to Rotate · Ctrl + Scroll to Zoom',
      ...options,
    };

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: this.opts.preserveDrawingBuffer });
    renderer.setPixelRatio(this.opts.pixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.className = 'v3d-canvas';
    this.renderer = renderer;
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();

    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(28, 1, 0.01, 100);
    this.camera.position.set(0, 0.5, 3);

    this.el = document.createElement('div');
    this.el.className = 'v3d';
    this.el.style.setProperty('--v3d-toolbar-height', `${this.opts.toolbarHeight}px`);
    this.el.appendChild(renderer.domElement);
    this.paneLayer = document.createElement('div');
    this.paneLayer.className = 'v3d-panes';
    this.toolbar = document.createElement('div');
    this.toolbar.className = 'v3d-toolbar viewer-controls';
    this.hint = document.createElement('div');
    this.hint.className = 'v3d-hint';
    this.hint.textContent = this.opts.hint;
    // 加载提示：模型下载期间在舞台中央显示文字与总进度（下面仍可见静态预览图）
    this.loading = document.createElement('div');
    this.loading.className = 'v3d-loading';
    this.loading.setAttribute('role', 'status');
    this.loading.innerHTML =
      '<div class="v3d-loading-box"><span class="v3d-spinner"></span><span class="v3d-loading-text">' +
      'Loading 3D Assets, Please Wait…</span><span class="v3d-pct">0%</span>' +
      '<span class="v3d-bar"><i></i></span></div>';
    this.el.append(this.paneLayer, this.toolbar, this.hint, this.loading);

    const controls = new OrbitControls(this.camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.rotateSpeed = 0.85;
    controls.zoomSpeed = 0.8;
    controls.autoRotate = this.opts.autoRotate;
    controls.autoRotateSpeed = this.opts.rotateSpeed;
    controls.addEventListener('start', () => this._onInteract(true));
    controls.addEventListener('end', () => this._onInteract(false));
    renderer.domElement.style.touchAction = 'pan-y'; // 手机上竖向滑动仍然滚动页面
    this.controls = controls;
    this.wantRotate = this.opts.autoRotate;

    // 普通滚轮留给页面滚动；按住 Ctrl/⌘ 或触控板捏合时才缩放
    this.el.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) {
        e.stopPropagation();
        this._flashHint();
      }
    }, { capture: true });

    this.panes = [];
    this.toggles = {};
    this.token = 0;
    this.clock = new THREE.Clock();
    this.running = false;
    this.visible = false;
    this._tick = this._tick.bind(this);
    this.resizeObs = new ResizeObserver(() => this._resize());
    this.visObs = new IntersectionObserver((entries) => {
      this.visible = entries[entries.length - 1].isIntersecting;
      this._updateLoop();
    }, { rootMargin: '120px' });
    this.visibilityHandler = () => this._updateLoop();
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  // 把画布与覆盖层挂到某个 stage 元素里（轮播切换时会在不同 slide 间移动）
  mount(stage) {
    if (this.stage === stage) return;
    this.stage?.classList.remove('is-live');
    this.resizeObs.disconnect();
    this.visObs.disconnect();
    this.stage = stage;
    stage.appendChild(this.el);
    this.resizeObs.observe(this.el);
    this.visObs.observe(this.el);
    this._resize();
  }

  // spec: { layout: 'row'|'grid', view: {azimuth, elevation, zoom}, toggles: [{key,label,on}],
  //         panes: [{ label, title, highlight, downloads: [{url, name, label, size}], items: [...] }] }
  // item:  {type:'glb'|'mask', url} | {type:'points', points, xray} | {type:'cloud', url|positions, onSurface}
  //        可带 toggle: 'key' 由工具栏开关控制显隐；glb 默认参与取景（fit:false 可关闭）
  async show(spec) {
    const token = ++this.token;
    this._clearPanes();
    this.spec = spec;
    this.el.classList.remove('is-ready');
    this.stage?.classList.remove('is-live');
    this._setLoading(0);
    this.toggles = Object.fromEntries((spec.toggles || []).map((t) => [t.key, !!t.on]));
    this.panes = spec.panes.map((p) => this._makePane(p));
    this._buildPaneLayer();
    this._buildToolbar();
    this._frame(spec.view, false);

    const jobs = [];
    for (const pane of this.panes) for (const item of pane.spec.items) jobs.push(this._loadItem(pane, item, token));
    const results = await Promise.allSettled(jobs);
    if (token !== this.token) return false;
    for (const r of results) if (r.status === 'rejected') console.warn('[viewer]', r.reason);

    this._applyToggles();
    this._frame(spec.view, true);
    this.el.classList.add('is-ready');
    this.stage?.classList.add('is-live');
    this._render();
    return true;
  }

  setToggle(key, on) {
    this.toggles[key] = on;
    this._applyToggles();
    this.toolbar.querySelector(`[data-toggle="${key}"]`)?.setAttribute('aria-pressed', String(on));
    this._render();
  }

  setAutoRotate(on) {
    this.wantRotate = on;
    this.controls.autoRotate = on;
    this.toolbar.querySelector('[data-action="rotate"]')?.setAttribute('aria-pressed', String(on));
  }

  resetView() {
    if (!this.home) return;
    this.controls.target.copy(this.home.target);
    this.camera.position.copy(this.home.position);
    this.controls.update();
    this._render();
  }

  // 构建期截图用：立即渲染一帧并返回 PNG dataURL
  snapshot() {
    this._resize();
    this._render();
    return this.renderer.domElement.toDataURL('image/png');
  }

  dispose() {
    this.token++;
    this.running = false;
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    this._clearPanes();
    this.resizeObs.disconnect();
    this.visObs.disconnect();
    this.controls.dispose();
    this.envMap.dispose();
    this.renderer.dispose();
    this.el.remove();
  }

  _grid() {
    const n = this.spec?.panes.length || 1;
    if (this.spec?.layout === 'chain') return { cols: n, rows: 1 };
    if (this.spec?.layout === 'row' && n === 2 && this.el.clientWidth && this.el.clientWidth < 520) return { cols: 1, rows: 2 };
    if (this.spec?.layout === 'grid' && n > 2) {
      const cols = Math.ceil(Math.sqrt(n));
      return { cols, rows: Math.ceil(n / cols) };
    }
    return { cols: n, rows: 1 };
  }

  _makePane(spec) {
    const scene = new THREE.Scene();
    scene.environment = this.envMap;
    scene.environmentIntensity = 0.9;
    const light = new THREE.DirectionalLight(0xffffff, 0.9);
    scene.add(light, light.target);
    return { spec, scene, light, fit: [], toggled: [], prog: new Map(), ui: null };
  }

  _clearPanes() {
    for (const p of this.panes) disposeObject(p.scene);
    this.panes = [];
  }

  async _loadItem(pane, item, token) {
    pane.prog.set(item, 0);
    const progress = (f) => this._progress(pane, item, f);
    let obj;
    if (item.type === 'glb' || item.type === 'mask') {
      const gltf = await getLoader().loadAsync(item.url, (e) => { if (e.total) progress(e.loaded / e.total); });
      obj = gltf.scene;
      if (item.type === 'mask') this._styleMask(obj);
      else this._styleModel(obj);
    } else if (item.type === 'points') {
      obj = makeSpheres(item.points, { radius: item.radius, xray: !!item.xray });
    } else if (item.type === 'cloud') {
      const pos = item.positions || await fetchCloud(item.url);
      obj = makeCloud(pos, { size: item.size, color: item.color, onSurface: !!item.onSurface });
    } else {
      throw new Error('unknown item type: ' + item.type);
    }
    progress(1);
    if (token !== this.token) {
      disposeObject(obj);
      return;
    }
    if (item.toggle) {
      obj.userData.toggle = item.toggle;
      obj.visible = !!this.toggles[item.toggle];
      pane.toggled.push(obj);
    }
    if ((item.type === 'glb' && item.fit !== false) || item.fit === true) pane.fit.push(obj);
    pane.scene.add(obj);
    this._render();
  }

  _styleModel(root) {
    // 材质按文件原样渲染（金属度等的统一在构建脚本里完成），这里只提高贴图各向异性过滤
    root.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        for (const k of ['map', 'metalnessMap', 'roughnessMap', 'normalMap']) if (m[k]) m[k].anisotropy = this.maxAniso;
      }
    });
  }

  _styleMask(root) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.material = new THREE.MeshBasicMaterial({ color: COLOR.mask, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide });
      o.renderOrder = 10;
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(o.geometry, 30),
        new THREE.LineBasicMaterial({ color: COLOR.maskEdge, transparent: true, opacity: 0.55, depthWrite: false }),
      );
      edges.renderOrder = 11;
      o.add(edges);
    });
  }

  _applyToggles() {
    for (const p of this.panes) for (const o of p.toggled) o.visible = !!this.toggles[o.userData.toggle];
  }

  _frame(view = {}, useContent = true) {
    const box = new THREE.Box3();
    if (useContent) for (const p of this.panes) for (const o of p.fit) box.expandByObject(o);
    if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const az = THREE.MathUtils.degToRad(view.azimuth ?? 35);
    const el = THREE.MathUtils.degToRad(view.elevation ?? 18);
    let fov = THREE.MathUtils.degToRad(this.camera.fov);
    if (this.opts.fitToAspect && !this.opts.fitBox) {
      const grid = this._grid();
      const paneHeight = (this.el.clientHeight - this.opts.toolbarHeight) / grid.rows - this.opts.paneHeaderHeight;
      const aspect = ((this.el.clientWidth - (grid.cols - 1) * this.opts.paneGap) / grid.cols) / Math.max(1, paneHeight);
      if (aspect > 0 && aspect < 1) fov = 2 * Math.atan(Math.tan(fov / 2) * aspect);
    }
    let dist = (sphere.radius / Math.sin(fov / 2)) * (view.zoom ?? 0.9);
    if (this.opts.fitBox) {
      // Fit the actual bounds across a full turn, without treating a tall asset as a sphere.
      const grid = this._grid();
      const paneWidth = (this.el.clientWidth - (grid.cols - 1) * this.opts.paneGap) / grid.cols;
      const paneHeight = (this.el.clientHeight - this.opts.toolbarHeight) / grid.rows - this.opts.paneHeaderHeight;
      const tanY = Math.tan(fov / 2), tanX = tanY * paneWidth / Math.max(1, paneHeight);
      let needed = 0;
      for (let turn = 0; turn < 16; turn++) {
        const yaw = az + turn * Math.PI / 8;
        const forward = new THREE.Vector3(Math.sin(yaw)*Math.cos(el), Math.sin(el), Math.cos(yaw)*Math.cos(el));
        const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
        const up = new THREE.Vector3(-Math.sin(yaw)*Math.sin(el), Math.cos(el), -Math.cos(yaw)*Math.sin(el));
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
          const point = new THREE.Vector3(x,y,z).sub(sphere.center);
          needed = Math.max(needed, point.dot(forward) + Math.max(Math.abs(point.dot(right))/tanX, Math.abs(point.dot(up))/tanY));
        }
      }
      dist = needed * (view.zoom ?? 1.08);
    }
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    this.home = { target: sphere.center.clone(), position: sphere.center.clone().addScaledVector(dir, dist) };
    this.controls.minDistance = dist * 0.3;
    this.controls.maxDistance = dist * 2.5;
    this.resetView();
  }

  _buildPaneLayer() {
    const { cols, rows } = this._grid();
    this.gridKey = `${cols}x${rows}`;
    const layer = this.paneLayer;
    layer.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    layer.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    layer.style.columnGap = `${this.opts.paneGap}px`;
    layer.innerHTML = '';
    this.panes.forEach((pane, i) => {
      const s = pane.spec;
      const cell = document.createElement('div');
      cell.className = 'v3d-pane';
      if (i % cols === cols - 1) cell.classList.add('is-last-col');
      if (Math.floor(i / cols) === rows - 1) cell.classList.add('is-last-row');
      // 每个窗格里的 3D 内容都给下载按钮：downloads = [{url, name, label, size}]
      const dls = (s.downloads || []).map((d) =>
        `<a class="v3d-download" href="${esc(d.url)}" download="${esc(d.name || '')}" title="Download ${esc(d.name || d.label)}${d.size ? ` (${esc(d.size)})` : ''}">${ICON.download}<span>${esc(d.label)}</span></a>`).join('');
      cell.innerHTML =
        (s.label ? `<div class="v3d-label${s.highlight ? ' is-ours' : ''}" title="${esc(s.title || s.label)}">${esc(s.label)}</div>` : '') +
        (dls ? `<div class="v3d-downloads">${dls}</div>` : '');
      pane.ui = cell;
      layer.appendChild(cell);
    });
    this.el.dispatchEvent(new Event('paneschange'));
  }

  _buildToolbar() {
    const tb = this.toolbar;
    tb.innerHTML = '';
    const add = (html, attrs, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'v3d-btn';
      for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
      b.innerHTML = html;
      b.addEventListener('click', onClick);
      tb.appendChild(b);
      return b;
    };
    for (const t of this.spec.toggles || []) {
      add(`<span class="v3d-switch"></span>${esc(t.label)}`, { 'data-toggle': t.key, 'aria-pressed': String(!!t.on) },
        () => this.setToggle(t.key, !this.toggles[t.key]));
    }
    add(`${ICON.rotate}<span>Rotate</span>`, { 'data-action': 'rotate', 'aria-pressed': String(this.wantRotate), title: 'Auto-rotate' },
      () => this.setAutoRotate(!this.wantRotate));
    add(`${ICON.reset}<span>Reset</span>`, { 'data-action': 'reset', title: 'Reset view' }, () => this.resetView());
  }

  _progress(pane, item, f) {
    pane.prog.set(item, f);
    let sum = 0;
    let n = 0;
    for (const p of this.panes) {
      for (const v of p.prog.values()) sum += v;
      n += p.spec.items.length;
    }
    this._setLoading(n ? sum / n : 1);
  }

  _setLoading(f) {
    const pct = Math.min(100, Math.round(100 * f));
    this.loading.querySelector('.v3d-pct').textContent = pct + '%';
    this.loading.querySelector('.v3d-bar i').style.transform = `scaleX(${pct / 100})`;
  }

  _onInteract(start) {
    clearTimeout(this.resumeTimer);
    if (start) {
      this.controls.autoRotate = false;
      this.el.classList.add('is-touched');
    } else if (this.wantRotate) {
      this.resumeTimer = setTimeout(() => { this.controls.autoRotate = this.wantRotate; }, 6000);
    }
  }

  _flashHint() {
    this.el.classList.add('show-hint');
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => this.el.classList.remove('show-hint'), 1400);
  }

  _resize() {
    const w = this.el.clientWidth;
    const h = this.el.clientHeight - this.opts.toolbarHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    // 宽度跨过窄屏阈值时窗格排布会变（横排 ↔ 上下排），同步重建窗格上的标签与下载按钮
    const g = this._grid();
    const key = `${g.cols}x${g.rows}`;
    if (this.spec && key !== this.gridKey) this._buildPaneLayer();
    if (this.opts.fitToAspect && this.home) this._frame(this.spec?.view, true);
    this._render();
  }

  _updateLoop() {
    const should = this.visible && !!this.stage && !document.hidden;
    if (should && !this.running) {
      this.running = true;
      this.clock.getDelta();
      requestAnimationFrame(this._tick);
    } else if (!should) {
      this.running = false;
    }
  }

  _tick() {
    if (!this.running) return;
    requestAnimationFrame(this._tick);
    this.controls.update(Math.min(this.clock.getDelta(), 0.1));
    this._render();
  }

  _render() {
    const W = this.el.clientWidth;
    const H = this.el.clientHeight - this.opts.toolbarHeight;
    if (!W || !H || !this.panes.length) return;
    const { cols, rows } = this._grid();
    const pw = (W - (cols - 1) * this.opts.paneGap) / cols;
    const ph = H / rows;
    const cam = this.camera;
    const renderHeight = Math.max(1, ph - this.opts.paneHeaderHeight);
    cam.aspect = pw / renderHeight;
    cam.updateProjectionMatrix();
    // 头灯：从相机右上方照向目标，任何角度都有清晰的明暗
    const target = this.controls.target;
    const offset = new THREE.Vector3(0.35, 0.6, 0).applyQuaternion(cam.quaternion).multiplyScalar(cam.position.distanceTo(target));
    const r = this.renderer;
    r.setScissorTest(false);
    r.clear();
    r.setScissorTest(true);
    this.panes.forEach((p, i) => {
      const x = (i % cols) * (pw + this.opts.paneGap);
      const y = H - (Math.floor(i / cols) + 1) * ph;
      r.setViewport(x, y, pw, renderHeight);
      r.setScissor(x, y, pw, renderHeight);
      p.light.position.copy(cam.position).add(offset);
      p.light.target.position.copy(target);
      r.render(p.scene, cam);
    });
  }
}
