// 패널 렌더러 — 변경된 패널만 다시 그리고, 입력값/스크롤/포커스를 보존한다.
import { PANELS, tickTimers } from './panels.js';

export function createRenderer(root, { onFrame } = {}) {
  let key = '';
  const els = {};
  let lastState = null;

  function build(layout, names) {
    root.className = `view ${layout}`;
    root.innerHTML = '';
    for (const k of Object.keys(els)) delete els[k];
    for (const name of names) {
      const p = PANELS[name];
      if (!p) { console.warn('알 수 없는 패널:', name); continue; }
      const el = document.createElement('section');
      el.className = `panel ${p.className || ''}`;
      el.dataset.panel = name;
      el.style.setProperty('--area', name);
      if (p.mount) p.mount(el);
      root.appendChild(el);
      els[name] = el;
    }
  }

  function render(ctx, layout, names) {
    lastState = ctx.state;
    const k = layout + '|' + names.join(',');
    if (k !== key) { key = k; build(layout, names); }
    for (const name of names) {
      const p = PANELS[name], el = els[name];
      if (!p || !el) continue;
      if (p.update) { p.update(el, ctx); continue; }
      const html = p.render(ctx);
      if (el._html === html) continue;
      el._html = html;
      replace(el, html);
    }
    tickTimers(root, lastState);
  }

  // 값/포커스/스크롤 보존하면서 교체
  function replace(el, html) {
    const kept = {};
    el.querySelectorAll('[data-keep]').forEach(i => (kept[i.dataset.keep] = { v: i.value, f: document.activeElement === i }));
    const scrolls = [...el.querySelectorAll('.panel-body')].map(b => b.scrollTop);
    el.innerHTML = html;
    el.querySelectorAll('[data-keep]').forEach(i => {
      const k = kept[i.dataset.keep];
      if (!k) return;
      i.value = k.v;
      if (k.f && !i.disabled) i.focus();
    });
    el.querySelectorAll('.panel-body').forEach((b, i) => (b.scrollTop = scrolls[i] ?? 0));
    const body = el.querySelector('[data-scroll-current]');
    const cur = body?.querySelector('.is-current');
    if (cur) body.scrollTo({ top: cur.offsetTop - body.clientHeight / 2 + cur.offsetHeight / 2, behavior: 'smooth' });
  }

  (function loop() {
    if (lastState) { tickTimers(root, lastState); onFrame?.(lastState); }
    requestAnimationFrame(loop);
  })();

  return { render };
}
