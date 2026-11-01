// SeMo3D 项目页 · 页面交互
// 结果区由 data.js 渲染：每个任务一组“对比视频轮播”+“交互式 3D 轮播”；另含导航进度、标签页、BibTeX 复制等。
// 注意：本文件是普通脚本（非 module），双击 html 用 file:// 打开时视频与轮播仍可用；3D 查看器需通过 http 访问。
(function () {
  'use strict';

  const DATA = window.SEMO3D_DATA;
  const CONFIG = window.SEMO3D_DISPLAY || {};
  const JS_BASE = document.currentScript.src.replace(/[^/]*$/, '');
  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const ICON = {
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
    replay: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  };
  const LEGEND = {
    gen: '<p class="gcase-legend"><span class="lg lg-point"></span>32 Sparse Points (Left Pane)</p>',
    edit: '<p class="gcase-legend"><span class="lg lg-mask"></span>User-Specified Edit Region (on the Source)</p>',
    comp: '<p class="gcase-legend"><span class="lg lg-cloud"></span>Partial Input<span class="lg lg-point"></span>Point Hints</p>',
  };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const quote = (s) => `“${esc(s)}”`;
  const range = (n) => Array.from({ length: n }, (_, i) => i);

  // Presentation-only filtering: source assets and generated data remain intact.
  function displayCases(kind, task, cases) {
    const config = CONFIG[kind]?.[task] || {};
    const hidden = new Set(config.hidden || []);
    const byId = new Map(cases.map((c) => [c.id, c]));
    const order = [...new Set([...(config.order || []), ...cases.map((c) => c.id)])];
    return order.filter((id) => byId.has(id) && !hidden.has(id)).map((id) => {
      const c = byId.get(id);
      if (task !== 'multi') return c;
      const key = c.id === 'sofa_gold' ? 'sofa' : c.id;
      const prompts = CONFIG.multimodalPrompts?.[key];
      if (!Array.isArray(prompts) || prompts.length !== 4) return c;
      // One reviewed caption set serves video labels, 3D captions, and pane titles.
      // Keep the generated manifest and original inference metadata intact.
      if (kind === 'videos') return {
        ...c, prompts: [...prompts],
        ...(c.branches && { branches: c.branches.map((branch, i) => ({ ...branch, text: prompts[i] })) }),
      };
      return {
        ...c, prompts: [...prompts],
        spec: { ...c.spec, panes: c.spec.panes.map((pane, i) => ({ ...pane, title: prompts[i] })) },
      };
    });
  }

  function onVisible(el, cb, threshold = 0.2) {
    const io = new IntersectionObserver((entries) => cb(entries[entries.length - 1].isIntersecting), { threshold });
    io.observe(el);
    return io;
  }

  // ------------------------------------------------------------ 通用轮播（左右箭头 + 圆点 / 缩略图）
  class Carousel {
    constructor(root, { autoplay = 0, swipe = true, onChange, onVisibility } = {}) {
      this.root = root;
      this.track = root.querySelector('.cr-track');
      this.slides = [...this.track.children];
      this.n = this.slides.length;
      this.i = 0;
      this.onChange = onChange;
      this.onVisibility = onVisibility;
      this.autoplay = REDUCED_MOTION ? 0 : autoplay;
      this.navItems = [...root.querySelectorAll('[data-go]')];
      this.counter = root.querySelector('.cr-count');
      this.thumbBar = root.querySelector('.cr-thumbs');
      this.hover = false;
      this.inView = false;

      root.querySelector('.cr-prev').addEventListener('click', () => this.go(this.i - 1, true));
      root.querySelector('.cr-next').addEventListener('click', () => this.go(this.i + 1, true));
      for (const b of this.navItems) b.addEventListener('click', () => this.go(Number(b.dataset.go), true));
      root.addEventListener('keydown', (e) => {
        if (e.defaultPrevented || e.target.matches('input, textarea, select')) return;
        if (e.key === 'ArrowLeft') { this.go(this.i - 1, true); e.preventDefault(); }
        if (e.key === 'ArrowRight') { this.go(this.i + 1, true); e.preventDefault(); }
      });
      root.addEventListener('pointerenter', () => { this.hover = true; });
      root.addEventListener('pointerleave', () => { this.hover = false; });
      if (swipe) this._swipe();
      this.go(0);
      this.resizeObserver = new ResizeObserver(() => this._size());
      this.slides.forEach((slide) => this.resizeObserver.observe(slide));
      onVisible(root, (vis) => {
        this.inView = vis;
        this._timer();
        this.onVisibility?.(vis);
      });
    }

    go(i, user = false) {
      const prev = this.i;
      this.i = (i + this.n) % this.n;
      this.track.style.transform = `translateX(${-100 * this.i}%)`;
      this.slides.forEach((s, k) => {
        const on = k === this.i;
        s.classList.toggle('is-active', on);
        s.setAttribute('aria-hidden', String(!on));
        s.inert = !on;
      });
      this.navItems.forEach((b) => b.classList.toggle('is-active', Number(b.dataset.go) === this.i));
      if (this.counter) this.counter.textContent = `${this.i + 1} / ${this.n}`;
      if (this.thumbBar) {
        const t = this.navItems[this.i];
        const bar = this.thumbBar;
        bar.scrollTo({ left: t.offsetLeft - (bar.clientWidth - t.offsetWidth) / 2, behavior: user ? 'smooth' : 'auto' });
      }
      if (user) this._timer();
      this._size();
      this.onChange?.(this.i, prev);
    }

    _size() {
      const slide = this.slides[this.i];
      const height = slide?.getBoundingClientRect().height;
      if (height > 0) this.root.querySelector('.cr-viewport').style.height = `${height}px`;

    }

    _timer() {
      clearInterval(this.timerId);
      if (!this.autoplay || !this.inView) return;
      this.timerId = setInterval(() => {
        if (!this.hover && !document.hidden) this.go(this.i + 1);
      }, this.autoplay);
    }

    _swipe() {
      const vp = this.root.querySelector('.cr-viewport');
      let x0 = null, y0 = 0, id = null;
      vp.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse') return;
        x0 = e.clientX; y0 = e.clientY; id = e.pointerId;
      });
      vp.addEventListener('pointerup', (e) => {
        if (x0 === null || e.pointerId !== id) return;
        const dx = e.clientX - x0, dy = e.clientY - y0;
        x0 = null;
        if (Math.abs(dx) > 48 && Math.abs(dx) > 1.5 * Math.abs(dy)) this.go(this.i + (dx < 0 ? 1 : -1), true);
      });
      vp.addEventListener('pointercancel', () => { x0 = null; });
    }
  }

  function carouselShell(kind, slidesHtml, navHtml) {
    return `<div class="cr cr--${kind}" tabindex="0" aria-roledescription="carousel">
      <div class="cr-stage">
        <button class="cr-arrow cr-prev" type="button" aria-label="Previous case">${ICON.prev}</button>
        <div class="cr-viewport"><div class="cr-track">${slidesHtml}</div></div>
        <button class="cr-arrow cr-next" type="button" aria-label="Next case">${ICON.next}</button>
      </div>
      ${navHtml}
    </div>`;
  }

  const navDots = (n) => `<div class="cr-nav"><div class="cr-dots">${range(n).map((i) =>
    `<button class="cr-dot" type="button" data-go="${i}" aria-label="Case ${i + 1}"></button>`).join('')}</div><span class="cr-count"></span></div>`;

  const navThumbs = (cases) => `<div class="cr-nav cr-nav--thumbs"><div class="cr-thumbs">${cases.map((c, i) =>
    `<button class="cr-thumb" type="button" data-go="${i}" aria-label="Case ${i + 1}"><img src="${esc(c.thumb)}" alt="" loading="lazy" decoding="async"></button>`).join('')}</div><span class="cr-count"></span></div>`;

  // ------------------------------------------------------------ 对比视频轮播
  function clipVideo(clip, label) {
    return `<video muted loop playsinline preload="none" width="${clip.width || 360}" height="${clip.height || 360}"
      style="--clip-ar:${clip.width || 360}/${clip.height || 360}"
      aria-label="${esc(label)}" poster="${esc(clip.poster)}" data-src="${esc(clip.video)}"></video>`;
  }

  function multiVideoSlide(c) {
    const columns = c.branches.map((branch, i) => `<div class="multi-column">
      <div class="cond-label">Text <span class="gcase-num">${i + 1}</span></div>
      <p class="cond-text multi-column-prompt">${quote(branch.text)}</p>
      <div class="cond-label">Point <span class="gcase-num">${i + 1}</span></div>
      <div class="multi-column-point">${clipVideo(branch.point, `Point condition ${i + 1}`)}</div>
      <div class="cond-label multi-column-result-label">SeMo3D</div>
      <div class="multi-column-result">${clipVideo(branch.result, `SeMo3D result ${i + 1}`)}</div>
    </div>`).join('');
    return `<div class="cr-slide vcase vcase--multi-compare" data-case-id="${esc(c.id)}">
      <div class="vcase-cond"><div class="cond cond--image"><div class="cond-label">Image</div>
        <img class="cond-img image-frame" src="${esc(c.image)}" alt="Shared image condition" loading="lazy">
      </div></div><div class="multi-columns">${columns}</div></div>`;
  }

  function videoSlide(c) {
    if (c.branches) return multiVideoSlide(c);
    const text = c.text ? `<div class="cond cond--text"><div class="cond-label">Text</div><p class="cond-text">${quote(c.text)}</p></div>` : '';
    const point = c.point ? `<div class="cond cond--point"><div class="cond-label">Point</div>${clipVideo(c.point, 'Point condition')}</div>` : '';
    const columns = Math.max(...c.rows.map((row) => row.length));
    const rows = c.rows.map((row) => `<div class="result-row">${row.map((clip) =>
      `<figure class="result-cell${clip.ours ? ' is-ours' : ''}">
        <figcaption>${esc(clip.label)}</figcaption>${clipVideo(clip, clip.label)}
      </figure>`).join('')}</div>`).join('');
    return `<div class="cr-slide vcase">
      <div class="vcase-cond">
        <div class="cond cond--image"><div class="cond-label">Image</div><img class="cond-img image-frame" src="${esc(c.image)}" alt="Image condition" loading="lazy" decoding="async"></div>
        ${text}${point}
      </div>
      <div class="result-grid" style="--result-cols:${columns}">${rows}</div>
    </div>`;
  }

  function initVideoCarousel(el) {
    const cases = displayCases('videos', el.dataset.task, (window.SEMO3D_VIDEOS || DATA.videos)[el.dataset.task]);
    if (!cases.length) { el.closest('.board').hidden = true; return; }
    el.innerHTML = carouselShell('video', cases.map(videoSlide).join(''), navDots(cases.length));
    const slides = [...el.querySelectorAll('.cr-slide')];
    let visible = false, car = null;
    const playback = window.SeMoMediaController({
      videos: () => car ? [...slides[car.i].querySelectorAll('video')] : [],
      allVideos: () => [...el.querySelectorAll('video')],
      visible: () => visible,
    });
    car = new Carousel(el.firstElementChild, {
      autoplay: CONFIG.videoAutoAdvanceMs ?? 0,
      onChange: () => playback.sync(true),
      onVisibility: value => { visible = value; playback.sync(); },
    });
  }

  // ------------------------------------------------------------ 交互式 3D 轮播
  let viewerModule = null;
  const loadViewer = () => (viewerModule ??= import(JS_BASE + 'viewer3d.js'));

  function paneGrid(spec) {
    const n = spec.panes.length;
    if (spec.layout === 'grid' && n > 2) {
      const cols = Math.ceil(Math.sqrt(n));
      return { cols, rows: Math.ceil(n / cols) };
    }
    return { cols: n, rows: 1 };
  }

  function glbSlide(task, c) {
    const { cols, rows } = paneGrid(c.spec);
    const row2 = c.spec.layout === 'row' && c.spec.panes.length === 2;
    const posters = c.posters.map((p, i) => {
      const cls = [(i % cols === cols - 1) && 'is-last-col', (Math.floor(i / cols) === rows - 1) && 'is-last-row'].filter(Boolean).join(' ');
      return `<img class="${cls}" src="${esc(p)}" alt="" loading="lazy" decoding="async">`;
    }).join('');
    const meta = task === 'multi'
      ? `<div class="cond"><div class="cond-label">Text + Points <span class="cond-sub">(One per Result)</span></div>
           <ol class="gcase-prompts">${c.prompts.map((p, i) => `<li><span class="gcase-num">${i + 1}</span><span>${quote(p)}</span></li>`).join('')}</ol></div>`
      : `<div class="cond"><div class="cond-label">Text</div><p class="cond-text">${quote(c.text)}</p></div>${LEGEND[task] || ''}`;
    return `<div class="cr-slide gcase gcase--${task}">
      <div class="gcase-info">
        <div class="cond cond--image"><div class="cond-label">Image</div><img class="cond-img" src="${esc(c.image)}" alt="Image condition" loading="lazy" decoding="async"></div>
        <div class="gcase-meta">${meta}</div>
      </div>
      <div class="gcase-stage viewer-stage${row2 ? ' gcase-stage--row2' : ''}" style="--ar:${cols}/${rows};--cols:${cols}">
        <div class="gcase-posters">${posters}</div>
      </div>
    </div>`;
  }

  function initModelCarousel(el) {
    const task = el.dataset.task;
    const cases = displayCases('models', task, DATA.models[task]);
    if (!cases.length) { el.closest('.board').hidden = true; return; }
    el.innerHTML = carouselShell('glb', cases.map((c) => glbSlide(task, c)).join(''), navThumbs(cases));
    const stages = [...el.querySelectorAll('.gcase-stage')];
    let viewer = null;
    let shown = -1;
    let pending = 0;
    const show = (i) => {
      if (!viewer || shown === i) return;
      shown = i;
      viewer.mount(stages[i]);
      viewer.show(cases[i].spec);
    };
    const car = new Carousel(el.firstElementChild, {
      swipe: false, // 画布上的拖动用于旋转模型
      onChange: (i) => {
        clearTimeout(pending);
        pending = setTimeout(() => show(i), 480); // 等滑动动画结束再把画布移过去
      },
      onVisibility: async (vis) => {
        if (!vis || viewer) return;
        try {
          const { Viewer } = await loadViewer();
          viewer = viewer || new Viewer({ autoRotate: true });
          show(car.i);
        } catch (err) {
          console.warn('3D viewer unavailable (open the page via http(s) to enable it):', err);
          el.classList.add('no-3d');
        }
      },
    });
  }

  // ------------------------------------------------------------ 其他页面交互
  function initTeaser() {
    const video = document.querySelector('.teaser video');
    if (!video) return;
    video.loop = false;
    video.removeAttribute('loop');
    let visible = false, holdUntil = 0, timer = 0;
    const play = () => video.play().catch(() => {});
    function sync() {
      clearTimeout(timer);
      if (!visible || document.hidden) { video.pause(); return; }
      if (holdUntil) {
        const remaining = holdUntil - performance.now();
        if (remaining > 0) { timer = setTimeout(sync, remaining); return; }
        holdUntil = 0;
        video.currentTime = 0;
      }
      play();
    }
    video.addEventListener('ended', () => { holdUntil = performance.now() + 1000; sync(); });
    document.addEventListener('visibilitychange', sync);
    onVisible(video, value => { visible = value; sync(); });
  }

  function initCopy() {
    for (const btn of document.querySelectorAll('[data-copy]')) {
      const label = btn.textContent.trim() || 'Copy';
      btn.innerHTML = `${ICON.copy}<span>${esc(label)}</span>`;
      btn.addEventListener('click', async () => {
        const text = document.querySelector(btn.dataset.copy).textContent;
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = Object.assign(document.createElement('textarea'), { value: text });
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        btn.innerHTML = `${ICON.check}<span>Copied</span>`;
        btn.classList.add('is-done');
        setTimeout(() => { btn.innerHTML = `${ICON.copy}<span>${esc(label)}</span>`; btn.classList.remove('is-done'); }, 1600);
      });
    }
  }

  // 链接尚未公开的按钮：点击不跳转
  function initSoonLinks() {
    for (const a of document.querySelectorAll('a[data-soon]')) a.addEventListener('click', (e) => e.preventDefault());
  }

  // 结果区的任务标签页
  function initTabs() {
    for (const root of document.querySelectorAll('[data-tabs]')) {
      const tabs = [...root.querySelectorAll('[role="tab"]')];
      const select = (tab, focus) => {
        for (const t of tabs) {
          const on = t === tab;
          t.setAttribute('aria-selected', String(on));
          t.tabIndex = on ? 0 : -1;
          document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
        }
        root.dataset.active = tab.dataset.taskTab;
        if (focus) tab.focus();
      };
      tabs.forEach((t, k) => {
        t.addEventListener('click', () => select(t));
        t.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowRight') select(tabs[(k + 1) % tabs.length], true);
          if (e.key === 'ArrowLeft') select(tabs[(k - 1 + tabs.length) % tabs.length], true);
        });
      });
      select(tabs[0]);
    }
  }

  // 顶部导航高亮当前章节
  function initScrollSpy() {
    const links = [...document.querySelectorAll('[data-spy] a[href^="#"]')];
    if (!links.length) return;
    const map = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
    const sections = [...map.keys()].map((id) => document.getElementById(id)).filter(Boolean);
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        links.forEach((a) => a.classList.remove('is-current'));
        map.get(e.target.id)?.classList.add('is-current');
      }
    }, { rootMargin: '-35% 0px -60% 0px' });
    sections.forEach((s) => io.observe(s));
  }

  // Fit the text itself to the strip instead of spreading out empty gaps.
  function initTldr() {
    const strip = document.querySelector('.tldr');
    const items = strip?.querySelector('.tldr-items');
    if (!items) return;
    let lastWidth = -1;
    const fit = (force = false) => {
      if (!force && lastWidth === strip.clientWidth) return;
      lastWidth = strip.clientWidth;
      const style = getComputedStyle(strip);
      const available = strip.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
        - strip.querySelector('b').getBoundingClientRect().width - parseFloat(style.columnGap);
      let low = 14, high = 20;
      for (let i = 0; i < 12; i++) {
        const middle = (low + high) / 2;
        items.style.fontSize = `${middle}px`;
        if (items.scrollWidth <= available) low = middle;
        else high = middle;
      }
      items.style.fontSize = `${low}px`;
    };
    new ResizeObserver(() => fit()).observe(strip);
    document.fonts.ready.then(() => fit(true));
    fit();
  }

  function init() {
    document.querySelectorAll('.js-videos').forEach(initVideoCarousel);
    document.querySelectorAll('.js-models').forEach(initModelCarousel);
    initTldr();
    initTeaser();
    initCopy();
    initSoonLinks();
    initTabs();
    initScrollSpy();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
