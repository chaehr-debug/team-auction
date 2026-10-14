// 공통 유틸: 소켓, 서버 시계 보정, 아바타, 토스트, 이미지 업로드
import { CURRENCY } from './config.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = n => (n ?? 0).toLocaleString('ko-KR');

/** 크레딧 표기: 숫자 + 단위 (HTML) */
export const cr = n => `${fmt(n)}<span class="unit">${CURRENCY.unit}</span>`;
export { CURRENCY };

// ── 서버 시계 보정 (타이머를 클라이언트에서 부드럽게 그리기 위함) ──
let clockOffset = 0;
export const syncClock = serverNow => { clockOffset = serverNow - Date.now(); };
export const serverNow = () => Date.now() + clockOffset;

/** 현재 경매 타이머 남은 시간(ms) */
export function remainingMs(state) {
  const c = state?.current;
  if (!c) return 0;
  if (state.paused) return c.pausedRemainingMs ?? 0;
  return Math.max(0, c.endsAt - serverNow());
}

// ── 아바타: 이미지가 있으면 이미지, 없으면 이름 기반 더미 ──
function hue(str) {
  let h = 0;
  for (const ch of String(str)) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}
export function avatar(entity, { size, ring, square } = {}) {
  const name = entity?.name || '?';
  const style = [`--h:${hue(name)}`];
  if (size) style.push(`--size:${size}px`);
  if (ring) style.push(`--ring:${ring}`);
  const inner = entity?.image
    ? `<img src="${esc(entity.image)}" alt="" draggable="false">`
    : esc([...name][0]);
  return `<div class="avatar${square ? ' square' : ''}" style="${style.join(';')}">${inner}</div>`;
}

/** 감독 slot 번호 → 팀 색상 CSS 변수 */
export const teamColor = d => (d ? `var(--team-${d.slot % 8})` : 'var(--muted)');

// ── 토스트 ──
export function toast(msg, isErr = false) {
  let box = document.getElementById('toast');
  if (!box) { box = document.createElement('div'); box.id = 'toast'; document.body.appendChild(box); }
  const el = document.createElement('div');
  el.textContent = msg;
  if (isErr) el.className = 'err';
  box.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

// ── 이미지 업로드 (리사이즈 후 서버 저장 → URL 반환) ──
export async function uploadImage(file, max = 512) {
  const dataUrl = await new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      res(cv.toDataURL('image/webp', 0.9));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
  const r = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || '업로드 실패');
  return j.url;
}

/** 파일 선택 창 열기 */
export function pickFile(accept = 'image/*') {
  return new Promise(res => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept;
    inp.onchange = () => res(inp.files[0] || null);
    inp.click();
  });
}

// ── 실시간 연결 (WebSocket, 끊기면 자동 재접속) ──
// socket.on('connect' | 'disconnect' | 'state', fn), socket.call(ev, payload) → Promise<{ok, error?, ...}>
export function connect(code) {
  const handlers = {};
  const pending = new Map();
  let ws, seq = 0, retry = 0, pingTimer;
  const emit = (ev, data) => (handlers[ev] || []).forEach(fn => fn(data));

  function open() {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/${code}`);
    ws.onopen = () => {
      retry = 0;
      clearInterval(pingTimer);
      pingTimer = setInterval(() => ws.readyState === 1 && ws.send('ping'), 30000);
      emit('connect');
    };
    ws.onmessage = e => {
      if (e.data === 'pong') return;
      const m = JSON.parse(e.data);
      if (m.id != null) { pending.get(m.id)?.(m.res); pending.delete(m.id); }
      else emit(m.ev, m.data);
    };
    ws.onclose = () => {
      clearInterval(pingTimer);
      for (const res of pending.values()) res({ ok: false, error: '연결이 끊겼습니다.' });
      pending.clear();
      emit('disconnect');
      setTimeout(open, Math.min(5000, 300 * 2 ** retry++));
    };
  }
  open();

  return {
    on(ev, fn) { (handlers[ev] ||= []).push(fn); },
    call(ev, payload) {
      return new Promise(res => {
        if (ws.readyState !== 1) return res({ ok: false, error: '서버에 연결 중입니다.' });
        const id = ++seq;
        pending.set(id, res);
        ws.send(JSON.stringify({ id, ev, payload }));
        setTimeout(() => { if (pending.delete(id)) res({ ok: false, error: '응답 없음' }); }, 8000);
      });
    },
  };
}

/** 룸 상태에서 자주 쓰는 계산 */
export function derive(state) {
  const byId = Object.fromEntries(state.streamers.map(s => [s.id, s]));
  const dirById = Object.fromEntries(state.directors.map(d => [d.id, d]));
  const c = state.current;
  const held = d => (c && c.status === 'bidding' && c.highBidderId === d.id ? c.highBid : 0);
  const MIN = state.rules.minBid ?? 10;
  // 남은 팀원 자리(이번 영입 제외)마다 최소 입찰가만큼 남겨야 한다 (서버 logic.js 와 같은 규칙)
  const reserve = d => Math.max(0, state.settings.teamSize - d.roster.length - 1) * MIN;
  return {
    byId, dirById,
    held,
    available: d => d.points - held(d),
    isFull: d => d.roster.length >= state.settings.teamSize,
    minBidOf: s => Math.max(MIN, s?.minBid || 0),
    reserve,
    maxBid: d => Math.max(0, d.points - reserve(d)),
    currentStreamer: c ? byId[c.streamerId] : null,
    leader: c?.highBidderId ? dirById[c.highBidderId] : null,
    queue: state.phase === 'rebid' ? state.unsoldQueue : state.order,
  };
}

export const PHASES = [
  ['prep', '경매 준비'],
  ['auction', '경매'],
  ['rebid', '유찰 경매'],
  ['result', '결과'],
];
