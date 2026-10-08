// 1단계: 경매 룸 접속 (역할 선택 · 룸 생성 · 룸 입장)
import { avatar, uploadImage, pickFile, toast, esc, CURRENCY } from './common.js';

const $ = id => document.getElementById(id);
const MAX = 24;
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

// ── 옵저버: 스트리머 목록 ──
let streamers = [];
function renderRows() {
  $('sCount').textContent = streamers.filter(s => s.name.trim()).length;
  $('addRow').disabled = streamers.length >= MAX;
  $('streamerRows').innerHTML = streamers.map((s, i) => `
    <div class="streamer-row">
      <span class="idx num">${i + 1}</span>
      <button type="button" class="btn btn-ghost btn-sm" data-img="${i}" title="프로필 사진" style="padding:0">${avatar(s, { size: 34 })}</button>
      <input class="input grow" data-name="${i}" value="${esc(s.name)}" placeholder="스트리머 이름" maxlength="30">
      <button type="button" class="btn btn-ghost btn-sm" data-del="${i}">✕</button>
    </div>`).join('');
}
$('streamerRows').addEventListener('input', e => {
  const i = e.target.dataset.name;
  if (i !== undefined) { streamers[i].name = e.target.value; $('sCount').textContent = streamers.filter(s => s.name.trim()).length; }
});
$('streamerRows').addEventListener('click', async e => {
  const del = e.target.closest('[data-del]');
  if (del) { streamers.splice(+del.dataset.del, 1); return renderRows(); }
  const img = e.target.closest('[data-img]');
  if (img) {
    const f = await pickFile();
    if (!f) return;
    try { streamers[+img.dataset.img].image = await uploadImage(f); renderRows(); } catch (err) { toast(err.message, true); }
  }
});
$('addRow').onclick = () => { if (streamers.length < MAX) { streamers.push({ name: '', image: null }); renderRows(); } };
$('fillDummy').onclick = () => {
  streamers = Array.from({ length: MAX }, (_, i) => ({ name: `스트리머 ${String(i + 1).padStart(2, '0')}`, image: null }));
  renderRows();
};
$('pasteNames').onclick = () => {
  const text = prompt('스트리머 이름을 줄바꿈 또는 쉼표로 구분해 입력하세요 (최대 24명)');
  if (!text) return;
  streamers = text.split(/[\n,]/).map(s => s.trim()).filter(Boolean).slice(0, MAX).map(name => ({ name, image: null }));
  renderRows();
};
for (let i = 0; i < 8; i++) streamers.push({ name: '', image: null });
renderRows();

// ── 룸 생성 ──
$('createForm').onsubmit = async e => {
  e.preventDefault();
  const list = streamers.filter(s => s.name.trim());
  if (!list.length) return toast('스트리머를 1명 이상 등록하세요.', true);
  const r = await fetch('/api/rooms', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: $('title').value, timerSec: +$('timerSec').value, startPoints: +$('startPoints').value, streamers: list }),
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
