// 1단계: 경매 룸 접속 (역할 선택 · 룸 생성 · 룸 입장)
import { avatar, toast, esc, CURRENCY } from './common.js';

const $ = id => document.getElementById(id);
const MY_ROOMS = 'auction:myrooms';

// ── 역할 선택 ──
document.querySelectorAll('.role-btn').forEach(btn => btn.onclick = () => selectRole(btn.dataset.role));
function selectRole(r) {
  document.querySelectorAll('.role-btn').forEach(b => b.classList.toggle('on', b.dataset.role === r));
  $('observerPane').classList.toggle('hidden', r !== 'observer');
  $('myRoomsPane').classList.toggle('hidden', r !== 'observer' || !myRooms().length);
  $('directorPane').classList.toggle('hidden', r !== 'director');
  if (r === 'director') $('joinCode').focus();
}

// ── 감독: 룸 입장 ──
$('joinForm').onsubmit = e => {
  e.preventDefault();
  const v = $('joinCode').value.trim();
  const m = /\/r\/([A-Z0-9]+)/i.exec(v);
  location.href = `/r/${(m ? m[1] : v).toUpperCase()}`;
};

// ── 옵저버: 설정 슬라이더 ──
const syncRange = () => {
  $('timerVal').textContent = `${$('timerSec').value}초`;
  $('pointsVal').textContent = `${(+$('startPoints').value).toLocaleString()} ${CURRENCY.unit}`;
};
$('timerSec').oninput = $('startPoints').oninput = syncRange;
syncRange();

// ── 옵저버: 스트리머 명단 (고정 24인 — 서버 src/roster.js, 사진은 public/streamers/) ──
fetch('/api/streamers').then(r => r.json()).then(({ streamers }) => {
  $('sCount').textContent = streamers.length;
  $('streamerRows').innerHTML = streamers.map((s, i) => `
    <div class="streamer-row"><span class="idx num">${i + 1}</span>${avatar(s, { size: 34 })}<span class="name">${esc(s.name)}</span></div>`).join('');
}).catch(() => toast('스트리머 명단을 불러오지 못했습니다.', true));

// ── 룸 생성 ──
$('createForm').onsubmit = async e => {
  e.preventDefault();
  const r = await fetch('/api/rooms', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: $('title').value, timerSec: +$('timerSec').value, startPoints: +$('startPoints').value }),
  });
  const j = await r.json();
  if (!r.ok) return toast(j.error, true);
  localStorage.setItem(MY_ROOMS, JSON.stringify([{ code: j.code, key: j.observerKey, title: $('title').value, at: Date.now() }, ...myRooms()].slice(0, 20)));
  location.href = `/r/${j.code}?key=${j.observerKey}`;
};

// ── 내가 만든 룸 ──
function myRooms() { try { return JSON.parse(localStorage.getItem(MY_ROOMS) || '[]'); } catch { return []; } }
$('myRooms').innerHTML = myRooms().map(r => `
  <a class="btn" style="text-align:left;text-decoration:none" href="/r/${r.code}?key=${r.key}">
    <b>${esc(r.title)}</b> <span class="muted">· ${r.code} · ${new Date(r.at).toLocaleString('ko-KR')}</span></a>`).join('');
