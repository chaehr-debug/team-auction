// 룸 페이지 (옵저버 / 감독 / 시청자 공용)
import { connect, syncClock, derive, keepStats, toast, avatar, uploadImage, pickFile, esc, CURRENCY } from './common.js';
import { createRenderer } from './renderer.js';
import { VIEWS } from './views.js';
import { createSoundPlayer } from './sound.js';
import { applyBackgrounds } from './bg.js';
import { CAM } from './config.js';

const code = location.pathname.split('/').pop().toUpperCase();
const params = new URLSearchParams(location.search);
const observerKey = params.get('key');
const TOKEN_KEY = `auction:dir:${code}`;        // 탭별 감독 토큰 (여러 탭으로 감독 8명 테스트 가능)
const LAST_KEY = `auction:lastdir:${code}`;     // 브라우저 재시작 후 재입장용
const SCORES_KEY = 'auction:scores';            // 옵저버 개인 평가 점수 { 스트리머 이름: 점수 } — 지난 평가 불러오기용 (이 브라우저에만 저장)
const savedScores = () => { try { return JSON.parse(localStorage.getItem(SCORES_KEY) || '{}') || {}; } catch { return {}; } };
function saveScore(name, value) {
  const all = savedScores();
  if (value === '' || value == null) delete all[name]; else all[name] = +value;
  try { localStorage.setItem(SCORES_KEY, JSON.stringify(all)); } catch { /* 저장 불가 (사생활 보호 모드 등) */ }
}

// 개인 재접속 링크 (?token=...) — 토큰을 탭에 저장하고 주소창에서 지운다
if (params.get('token')) {
  sessionStorage.setItem(TOKEN_KEY, params.get('token'));
  params.delete('token');
  history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : ''));
}

const $ = id => document.getElementById(id);
const socket = connect(code);
// 효과음: 항상 켜짐 (브라우저 정책상 페이지를 한 번 클릭한 뒤부터 재생)
const sound = createSoundPlayer();
applyBackgrounds();
const renderer = createRenderer($('app'), { onFrame: s => sound.onFrame(s) });

let state = null;
let role = 'viewer';
let directorId = null;
let watchOnly = false;

const links = {
  director: `${location.origin}/r/${code}`,
  observer: `${location.origin}/r/${code}?key=${observerKey}`,
  overlay: `${location.origin}/overlay/${code}`,
  overlayLog: `${location.origin}/overlay/${code}?panels=log&bg=transparent`,
};

// ── 접속 ──
async function join() {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const r = await socket.call('join', { code, key: observerKey, token });
  if (!r.ok) return showMessage(r.error);
  role = r.role;
  directorId = r.directorId;
  if (observerKey && role !== 'observer') toast('옵저버 키가 올바르지 않습니다. 시청 모드로 접속합니다.', true);
  if (token && role !== 'director') sessionStorage.removeItem(TOKEN_KEY);
  onState(r.state);
}
socket.on('connect', () => { document.body.classList.remove('offline'); join(); });
socket.on('disconnect', () => document.body.classList.add('offline'));
fetch(`/api/rooms/${code}`).then(r => r.json()).then(r => { if (!r.exists) showMessage('존재하지 않는 룸입니다.'); });
socket.on('state', onState);

function onState(s) {
  keepStats(s);
  state = s;
  syncClock(s.serverNow);
  sound.onState(s);
  document.title = `${s.title} · 팀 경매`;
  const needRegister = role === 'viewer' && !observerKey && !watchOnly && s.phase === 'prep';
  $('register').classList.toggle('hidden', !needRegister);
  $('app').classList.toggle('hidden', needRegister);
  if (needRegister) return renderRegister();
  const view = VIEWS[s.phase][role];
  const me = s.directors.find(x => x.id === directorId) || null;
  renderer.render({ state: s, d: derive(s), role, me, links }, view.layout, view.panels);
}

function showMessage(msg) {
  $('message').classList.remove('hidden');
  $('messageText').innerHTML = `<h2>${esc(msg)}</h2><a class="btn" href="/">처음으로</a>`;
}

// ── 감독 등록 ──
let regImage = null;
function renderRegister() {
  $('regTitle').textContent = `${state.title} — 감독 입장`;
  $('regInfo').textContent = `시작 ${CURRENCY.name} ${state.settings.startPoints.toLocaleString()} ${CURRENCY.unit} · 감독 ${state.directors.length}/${state.rules.maxDirectors}`;
  $('regAvatar').innerHTML = avatar({ name: $('regName').value || '?', image: regImage }, { size: 64 });
  const last = JSON.parse(localStorage.getItem(LAST_KEY) || 'null');
  const lastValid = last && state.directors.some(d => d.name === last.name);
  $('regResume').classList.toggle('hidden', !lastValid);
  if (lastValid) $('regResume').textContent = `이전 감독 "${last.name}"(으)로 재입장`;
}
$('regName').addEventListener('input', () => state && renderRegister());
$('regImage').onclick = async () => {
  const f = await pickFile();
  if (!f) return;
  try { regImage = await uploadImage(f); renderRegister(); } catch (e) { toast(e.message, true); }
};
$('registerForm').onsubmit = async e => {
  e.preventDefault();
  const r = await socket.call('director:register', { name: $('regName').value, image: regImage });
  if (!r.ok) return toast(r.error, true);
  sessionStorage.setItem(TOKEN_KEY, r.token);
  localStorage.setItem(LAST_KEY, JSON.stringify({ token: r.token, name: $('regName').value.trim() }));
  role = 'director'; directorId = r.directorId;
  onState(state);
};
$('regResume').onclick = () => {
  const last = JSON.parse(localStorage.getItem(LAST_KEY) || 'null');
  if (!last) return;
  sessionStorage.setItem(TOKEN_KEY, last.token);
  join();
};
$('regWatch').onclick = () => { watchOnly = true; onState(state); };

// ── 버튼 동작 (data-action 위임) ──
const send = async (ev, payload) => {
  const r = await socket.call(ev, payload);
  if (!r.ok) toast(r.error, true);
  return r;
};
const bidInput = () => document.querySelector('[data-keep="bidAmount"]');

const ACTIONS = {
  // ── 감독 캠 ──
  camCreate: async () => {
    const me = state.directors.find(x => x.id === directorId);
    if (me?.cam && !confirm('새 캠 링크를 만들면 기존 링크는 해제됩니다. 계속할까요?')) return;
    const id = Array.from(crypto.getRandomValues(new Uint8Array(6)), b => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
    // 팝업 차단을 피하려고 클릭 직후 바로 창을 연다
    window.open(CAM.pushUrl(id), '_blank', 'noopener');
    const r = await send('director:update', { cam: CAM.viewUrl(id) });
    if (r.ok) toast('캠 링크가 등록되었습니다. 열린 창에서 카메라를 선택해주세요.');
  },
  camSave: async () => {
    const inp = document.querySelector('[data-keep="camLink"]');
    if (!inp.value.trim()) return toast('링크를 입력하세요.', true);
    const r = await send('director:update', { cam: inp.value.trim() });
    if (r.ok) { inp.value = ''; toast('캠 링크가 저장되었습니다.'); }
  },
  camClear: () => confirm('캠 링크를 해제할까요?') && send('director:update', { cam: '' }),
  setCam: el => {
    const d = state.directors.find(x => x.id === el.dataset.id);
    const v = prompt(`${d.name} 감독의 캠 링크 (vdo.ninja 시청 링크, 비우면 해제)`, d.cam || '');
    if (v !== null) send('director:setCam', { id: d.id, cam: v });
  },
  copy: el => navigator.clipboard.writeText(el.dataset.text).then(() => toast('복사되었습니다')),
  shuffle: () => send('prep:shuffle'),
  loadScores: async () => {
    const scores = savedScores();
    if (!Object.keys(scores).length) return toast('이 브라우저에 저장된 지난 평가 점수가 없습니다.', true);
    const r = await send('prep:setScores', { scores });
    if (r.ok) toast('지난 개인 평가 점수를 불러왔습니다.');
  },
  move: el => {
    const order = state.order.slice();
    const i = order.indexOf(el.dataset.id), j = i + +el.dataset.dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    send('prep:setOrder', { order });
  },
  streamerImage: async el => {
    const f = await pickFile();
    if (f) send('prep:setStreamerImage', { id: el.dataset.id, image: await uploadImage(f) });
  },
  myImage: async () => {
    const f = await pickFile();
    if (f) send('director:update', { image: await uploadImage(f) });
  },
  kick: el => confirm('이 감독을 내보낼까요?') && send('prep:kick', { id: el.dataset.id }),
  fillBots: () => send('prep:fillBots'),
  // ── 옵저버 정정 ──
  restartLot: () => {
    const s = state.streamers.find(x => x.id === state.current?.streamerId);
    const c = state.current;
    const what = c?.status === 'reveal' ? (c.result === 'sold' ? '낙찰을 취소하고 ' : '유찰을 취소하고 ') : '';
    if (s && confirm(`${s.name} 경매를 ${what}처음부터 다시 진행할까요?`)) send('lot:restart');
  },
  revoke: el => {
    const s = state.streamers.find(x => x.id === el.dataset.id);
    const dir = state.directors.find(x => x.id === s?.teamId);
    if (!s || !confirm(`${s.name} 낙찰을 취소할까요?\n${dir?.name ?? ''} 팀에 ${s.price} 크레딧을 돌려주고, 유찰 경매에서 다시 경매합니다.`)) return;
    send('sale:revoke', { id: s.id });
  },
  start: () => {
    const n = state.directors.length;
    if (n < state.rules.maxDirectors && !confirm(`감독이 ${n}명입니다. 그래도 경매를 시작할까요?`)) return;
    send('auction:start');
  },
  pause: () => send('auction:pause'),
  resume: () => send('auction:resume'),
  bid: () => {
    const inp = bidInput();
    const v = inp.value === '' ? +inp.dataset.min : +inp.value;
    send('bid', { amount: v }).then(r => { if (r.ok) inp.value = ''; });
  },
  bidQuick: el => { bidInput().value = el.dataset.v; bidInput().focus(); },
  bidAdd: el => {
    const inp = bidInput();
    const base = inp.value === '' ? +inp.dataset.min - 10 : +inp.value;
    inp.value = Math.min(Math.max(+inp.dataset.min, base + +el.dataset.v), +inp.max || Infinity);   // 최대 입찰 가능액을 넘지 않게
    inp.focus();
  },
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled || el.tagName === 'INPUT') return;
  ACTIONS[el.dataset.action]?.(el);
});
// 최소 입찰가 입력
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset?.action === 'minbid') send('prep:setMinBid', { id: el.dataset.id, minBid: el.value });
  if (el.dataset?.action === 'score') {
    send('prep:setScore', { id: el.dataset.id, score: el.value }).then(r => { if (r?.ok) saveScore(el.dataset.name, el.value.trim()); });
  }
});
// 입찰: Enter 키
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.dataset?.keep === 'bidAmount') { e.preventDefault(); ACTIONS.bid(); }
});

// ── 드래그로 순서 변경 ──
let dragId = null;
document.addEventListener('dragstart', e => {
  const li = e.target.closest?.('[data-drag-id]');
  if (!li) return;
  dragId = li.dataset.dragId;
  li.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
});
document.addEventListener('dragend', () => {
  dragId = null;
  document.querySelectorAll('.dragging, .drag-over').forEach(x => x.classList.remove('dragging', 'drag-over'));
});
document.addEventListener('dragover', e => {
  const li = e.target.closest?.('[data-drag-id]');
  if (!li || !dragId) return;
  e.preventDefault();
  document.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'));
  li.classList.add('drag-over');
});
document.addEventListener('drop', e => {
  const li = e.target.closest?.('[data-drag-id]');
  if (!li || !dragId) return;
  e.preventDefault();
  const order = state.order.filter(id => id !== dragId);
  order.splice(order.indexOf(li.dataset.dragId) + (state.order.indexOf(dragId) < state.order.indexOf(li.dataset.dragId) ? 1 : 0), 0, dragId);
  send('prep:setOrder', { order });
});
