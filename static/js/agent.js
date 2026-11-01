// One input and three results form a single, synchronized four-column chain.
const root = document.querySelector('[data-agent-showcase]');
const chains = window.SEMO3D_AGENT_CHAINS;
if (root && chains?.length) {
  const stage = root.querySelector('[data-agent-stage]');
  const status = root.querySelector('[data-agent-status]');
  const tabs = [...root.querySelectorAll('[data-agent-chain]')];
  const prompts = root.querySelector('[data-agent-prompts]');
  const caseBar = root.querySelector('[data-agent-cases]');
  const caseCount = root.querySelector('[data-agent-count]');
  const casePrev = root.querySelector('[data-agent-prev]');
  const caseNext = root.querySelector('[data-agent-next]');
  const casesFor = task => chains.filter(chain => (chain.task || chain.id) === task);
  let task = 'generation', caseIndex = 0;
  const current = () => casesFor(task)[caseIndex];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let revision = 0, visible = false, loadingRevision = -1;
  let viewer, viewerPromise;
  function columns() {
    const chain = current();
    return task === 'generation' ? [{id:'generation_input', image:chain.steps[0].guidance}, ...chain.steps] : chain.steps;
  }
  function decoratePanes() {
    if (!viewer || viewer.spec?.chainId !== current().id) return;
    columns().forEach((step, i) => {
      const cell = viewer.panes[i]?.ui;
      const label = cell?.querySelector('.v3d-label');
      if (label) label.textContent = (stage.clientWidth-(4-1)*metrics().gap)/4 < 150 ? viewer.panes[i].spec.label.replace('Generation','Gen.').replace('Completion','Comp.') : viewer.panes[i].spec.label;
      if (!cell || cell.querySelector('.agent-preview')) return;
      if (step.image) {
        const frame = document.createElement('div'); frame.className = 'agent-image-frame agent-preview';
        frame.innerHTML = `<img src="${esc(step.image)}" alt="Image guidance for ${esc(current().title || 'traveler')}">`;
        cell.append(frame);
      } else {
        const poster = document.createElement('img'); poster.className = 'agent-preview chain-poster';
        poster.src = step.poster; poster.alt = `Preview: ${i === 0 ? 'partial input' : i === 1 ? 'initial result' : `editing result ${i - 1}`}`;
        cell.append(poster);
      }
    });
  }
  function metrics() {
    const width = stage.clientWidth;
    return {gap:width < 500 ? 8 : width < 900 ? 22 : Math.min(84,width*.08),header:width < 500 ? 62 : 42};
  }
  function resizeStage() {
    const {gap,header} = metrics();
    stage.style.setProperty('--agent-gap', `${gap}px`);
    stage.style.setProperty('--agent-header', `${header}px`);
    stage.dataset.compact = String(stage.clientWidth < 900);
    root.dataset.compact = stage.dataset.compact;
    root.dataset.small = String(stage.clientWidth < 500);
    if (viewer) {
      const changed = viewer.opts.paneGap !== gap || viewer.opts.paneHeaderHeight !== header;
      viewer.opts.paneGap=gap;viewer.opts.paneHeaderHeight=header;
      if (changed && viewer.spec) viewer._buildPaneLayer();
      if (changed) viewer._resize();
    }
  }
  new ResizeObserver(resizeStage).observe(stage);
  async function ensureViewer() {
    if (!viewerPromise) viewerPromise = import('./viewer3d.js').then(({ Viewer }) => {
      viewer = new Viewer({ autoRotate: true, rotateSpeed: 1.2, fitToAspect: true, fitBox: true, paneGap: metrics().gap, paneHeaderHeight: metrics().header, toolbarHeight: parseFloat(getComputedStyle(stage).getPropertyValue('--viewer-toolbar-height')) || 48 });
      viewer.el.addEventListener('paneschange', decoratePanes);
      viewer.mount(stage);
      return viewer;
    });
    return viewerPromise;
  }
  async function showChain(expected) {
    if (loadingRevision === expected) return;
    loadingRevision = expected;
    try {
      const active = await ensureViewer();
      if (revision !== expected) return;
      const chain = current();
      const labels = ['Input', task === 'generation' ? 'Generation' : 'Completion', 'Edit 1', 'Edit 2'];
      const spec = {layout:'chain', chainId:chain.id, view:chain.view || {azimuth:0,elevation:5,zoom:1.1}, toggles:[],
        panes:columns().map((step, i) => step.image ? {label:labels[i],downloads:[{url:step.image,name:`SeMo3D_${chain.id}_reference.webp`,label:'Image'}],items:[]} : {
          ...step.spec.panes[0], label:labels[i],
          items:step.spec.panes[0].items.filter(item => item.type !== 'mask').map(item => {const copy={...item};delete copy.toggle;return copy;})
        })};
      active.setAutoRotate(true);
      const ready = active.show(spec); decoratePanes();
      await ready;
      if (revision !== expected) return;
      root.dataset.loadedChain = chain.id;
      status.textContent = `${task === 'generation' ? 'Generation' : 'Completion'} chain: input, initial result, and two editing results. All 3D stages rotate together.`;
    } catch (error) {
      console.warn('Agentic 3D view unavailable:', error);
      status.classList.remove('sr-only'); status.classList.add('agent-error');
      status.textContent = 'The 3D chain could not be loaded. Please refresh to try again.';
    }
  }
  function selectCase(index, focus = false) {
    caseIndex = index; revision++;
    const chain = current();
    root.dataset.task = task;
    root.dataset.chain = chain.id; delete root.dataset.loadedChain;
    stage.classList.remove('is-live');
    [...caseBar.querySelectorAll('button')].forEach((button,i) => {button.setAttribute('aria-pressed',String(i===index));button.classList.toggle('is-active',i===index);});
    const activeButton = caseBar.querySelectorAll('button')[index];
    // Keep the current thumbnail visible without scrolling the surrounding page.
    if (activeButton) {
      const buttonRect=activeButton.getBoundingClientRect(), barRect=caseBar.getBoundingClientRect();
      if (buttonRect.left < barRect.left+4) caseBar.scrollLeft += buttonRect.left-barRect.left-4;
      else if (buttonRect.right > barRect.right-4) caseBar.scrollLeft += buttonRect.right-barRect.right+4;
    }
    caseCount.textContent = `${index+1} / ${casesFor(task).length}`;
    stage.querySelector('.agent-transitions')?.remove();
    const transitions = document.createElement('div'); transitions.className = 'agent-transitions';
    const resultSteps = task === 'generation' ? chain.steps : chain.steps.slice(1);
    transitions.innerHTML = resultSteps.map((step,i) => `<div class="agent-transition" style="--boundary:${i+1}"><p>&ldquo;${esc(step.displayPrompt)}&rdquo;</p><svg viewBox="0 0 100 16" aria-hidden="true"><path d="M2 8H96M89 1L96 8 89 15"/></svg></div>`).join('');
    stage.append(transitions);
    const labels = [task==='generation'?'Generate':'Complete','Edit 1','Edit 2'];
    prompts.innerHTML = resultSteps.map((step,i) => `<div><span>${labels[i]}</span><p>&ldquo;${esc(step.displayPrompt)}&rdquo;</p><svg viewBox="0 0 100 16" aria-hidden="true"><path d="M2 8H96M89 1L96 8 89 15"/></svg></div>`).join('');
    resizeStage();
    if (visible) showChain(revision);
    if (focus) caseBar.querySelectorAll('button')[index].focus();
  }
  function selectTask(index, focus = false) {
    task = tabs[index].dataset.agentChain;
    tabs.forEach((tab,i) => {tab.setAttribute('aria-selected',String(i===index));tab.tabIndex=i===index?0:-1;});
    root.querySelector('#agent-workspace').setAttribute('aria-labelledby',tabs[index].id);
    caseBar.replaceChildren();
    casesFor(task).forEach((chain,i,array) => {
      const button=document.createElement('button');button.type='button';button.dataset.agentCase=chain.id;button.className='cr-thumb';
      button.title=chain.title;button.setAttribute('aria-label',`Case ${i+1}: ${chain.title}`);
      const image=document.createElement('img');image.loading='lazy';image.decoding='async';image.src=task==='generation'?chain.steps[0].guidance:chain.steps.find(step=>step.operation==='input').poster;image.alt=`${chain.title}: ${task==='generation'?'image input':'partial point cloud'}`;button.append(image);
      button.addEventListener('click',()=>selectCase(i));
      button.addEventListener('keydown',event=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        event.preventDefault();selectCase(event.key==='Home'?0:event.key==='End'?array.length-1:(i+(event.key==='ArrowRight'?1:-1)+array.length)%array.length,true);
      });
      caseBar.append(button);
    });
    selectCase(0);
    if(focus)tabs[index].focus();
  }
  casePrev?.addEventListener('click',()=>selectCase((caseIndex-1+casesFor(task).length)%casesFor(task).length));
  caseNext?.addEventListener('click',()=>selectCase((caseIndex+1)%casesFor(task).length));
  tabs.forEach((tab,i)=>{
    tab.addEventListener('click',()=>selectTask(i));
    tab.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();selectTask(event.key==='Home'?0:event.key==='End'?tabs.length-1:(i+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length,true);
    });
  });
  new IntersectionObserver(entries => {
    visible = entries[entries.length - 1].isIntersecting;
    if (visible) showChain(revision);
  }, {rootMargin:'100px'}).observe(root);
  selectTask(0);
}
