// ============================================================
// 패널(화면 조각) 모음.
// 각 패널은 { title?, render(ctx) → HTML } 또는 { mount(el), update(el, ctx) } 형태.
// 새 패널을 추가하면 views.js 와 layout.css 에 이름만 등록하면 됩니다.
// ctx = { state, d(파생값), role, me(내 감독 정보), links, sound? }
// ============================================================
import { esc, fmt, cr, CURRENCY, avatar, teamColor, remainingMs, PHASES, mostPicks } from './common.js';
import { CAM } from './config.js';

const panel = (title, body, extra = '') =>
  `${title ? `<div class="panel-title"><span>${title}</span>${extra}</div>` : ''}${body}`;

// ── 헤더 ──
const header = {
  className: 'header',
  render({ state, role, me }) {
    const phaseIdx = PHASES.findIndex(p => p[0] === state.phase);
    const steps = PHASES.map(([k, label], i) => `<span class="${i === phaseIdx ? 'on' : ''}">${i + 2}. ${label}</span>`).join('');
    // 옵저버 화면은 제목만, 감독/시청자는 룸 코드와 역할 표시
    const badges = role === 'observer' ? '' : `
        <span class="badge">ROOM ${esc(state.code)}</span>
        <span class="badge accent">${role === 'director' ? `감독 · ${esc(me?.name)}` : '시청'}</span>`;
    // 옵저버: 경매 중 일시 정지 / 재진행 버튼
    const running = state.phase === 'auction' || state.phase === 'rebid';
    const pauseBtn = role === 'observer' && running
      ? (state.paused
        ? `<button class="btn btn-primary" data-action="resume">▶ 경매 재진행</button>`
        : `<button class="btn" data-action="pause">⏸ 경매 일시 정지</button>`)
      : '';
    const fixBtn = role === 'observer' && running && state.current
      ? `<button class="btn" data-action="restartLot" title="현재 스트리머 경매를 처음부터 다시 (결과 표시 중이면 낙찰/유찰 취소)">↺ 현재 경매 다시</button>` : '';
    const statsLink = state.phase === 'result' ? `<a class="btn" href="/stats" target="_blank" rel="noopener">📊 모의 경매 시세표</a>` : '';
    return `
      <div class="row" style="gap:14px">
        <h1>${esc(state.title)}</h1>${badges}
      </div>
      <div class="row" style="gap:14px">
        <span class="muted">시작 <span class="num">${cr(state.settings.startPoints)}</span> · 타이머 <span class="num">${state.settings.timerSec}</span>초 · 재입찰 <span class="num">${state.settings.bidResetSec}</span>초</span>
        <div class="phase-steps">${steps}</div>
        ${fixBtn}${pauseBtn}${statsLink}
      </div>`;
  },
};

// ── 공유 링크 (옵저버 준비 단계) ──
const share = {
  render({ links }) {
    const row = (label, url, hint) => `
      <div class="field">
        <label>${label}${hint ? ` <span class="muted" style="font-weight:400">· ${hint}</span>` : ''}</label>
        <div class="share-row"><code>${esc(url)}</code><button class="btn btn-sm" data-action="copy" data-text="${esc(url)}">복사</button></div>
      </div>`;
    return panel('룸 링크', `
      ${row('감독 입장 링크', links.director, '감독 8명에게 공유')}
      ${row('방송 오버레이', links.overlay, 'OBS 브라우저 소스')}
      ${row('로그만 오버레이', links.overlayLog, '채팅창 형태')}
      ${row('옵저버 링크', links.observer, '⚠ 비공개 — 진행자 전용')}
    `);
  },
};

// ── 경매 순서 (준비 단계) ──
const order = {
  render({ state, d, role }) {
    const editable = role === 'observer' && state.phase === 'prep';
    const items = state.order.map((id, i) => {
      const s = d.byId[id];
      const minBid = editable
        ? `<input class="input minbid num" type="number" min="${state.rules.minBid}" step="10" value="${d.minBidOf(s)}" data-action="minbid" data-id="${s.id}" title="최소 입찰 ${CURRENCY.name}">`
        : `<span class="minbid num">최소 ${cr(d.minBidOf(s))}</span>`;
      const tools = editable ? `
        <button class="btn btn-sm btn-ghost" data-action="move" data-id="${s.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>▲</button>
        <button class="btn btn-sm btn-ghost" data-action="move" data-id="${s.id}" data-dir="1" ${i === state.order.length - 1 ? 'disabled' : ''}>▼</button>
        <button class="btn btn-sm btn-ghost" data-action="streamerImage" data-id="${s.id}" title="프로필 사진">사진</button>` : '';
      return `<li class="order-item" ${editable ? `draggable="true" data-drag-id="${s.id}"` : ''}>
        <span class="idx num">${i + 1}</span>${avatar(s, { size: 36 })}<span class="name">${esc(s.name)}</span>${minBid}${tools}</li>`;
    }).join('');
    const extra = editable
      ? `<button class="btn btn-sm" data-action="shuffle">🎲 무작위 순서</button>`
      : `<span class="num">${state.order.length}명</span>`;
    const hint = editable ? `<div class="muted" style="font-size:13px">드래그 또는 ▲▼로 순서 변경 · 모든 스트리머 최소 입찰가는 ${cr(state.rules.minBid)} 이상</div>` : '';
    return panel(`경매 순서 (${state.order.length}명)`, `${hint}<div class="panel-body"><ol class="order-list">${items}</ol></div>`, extra);
  },
};

// ── 경매 진행 순서 (경매 단계) ──
// 정렬: [완료(낙찰)] → [현재] → [다음 순서] → [유찰 — 맨 뒤, 유찰 표시 유지]
function lineup(state, d) {
  const q = d.queue;
  const c = state.current;
  const curId = c?.streamerId ?? null;
  const done = q.slice(0, Math.max(0, state.cursor)).filter(id => d.byId[id].status === 'sold' && id !== curId);
  const next = q.slice(state.cursor + 1);
  const unsold = state.passUnsold.filter(id => id !== curId);
  return { done, curId, next, unsold };
}

function lineupItem(s, d, kind, label) {
  let tag = '';
  if (kind === 'done') {
    const dir = d.dirById[s.teamId];
    tag = `<span class="badge" style="background:${teamColor(dir)};color:#111">${esc(dir?.name)} · <span class="num">${cr(s.price)}</span></span>`;
  } else if (kind === 'unsold') tag = '<span class="badge unsold">유찰</span>';
  else if (d.minBidOf(s) > d.minBidOf(null)) tag = `<span class="muted num" style="font-size:12px">최소 ${cr(d.minBidOf(s))}</span>`;
  const cls = { done: 'is-done', current: 'is-current', unsold: 'is-unsold', next: '' }[kind];
  return `<li class="order-item ${cls}"><span class="idx num">${label}</span>${avatar(s, { size: 30 })}<span class="name">${esc(s.name)}</span>${tag}</li>`;
}

function renderLineup(state, d, { showDone }) {
  const { done, curId, next, unsold } = lineup(state, d);
  const rows = [];
  if (showDone) done.forEach(id => rows.push(lineupItem(d.byId[id], d, 'done', '✓')));
  if (curId) rows.push(lineupItem(d.byId[curId], d, 'current', 'NOW'));
  next.forEach((id, i) => rows.push(lineupItem(d.byId[id], d, 'next', i + 1)));
  if (unsold.length) {
    const label = state.phase === 'rebid' ? '다시 유찰 · 재경매 대기' : '유찰 · 유찰 경매 대기';
    rows.push(`<li class="order-divider">${label}</li>`);
    unsold.forEach(id => rows.push(lineupItem(d.byId[id], d, 'unsold', '–')));
  }
  if (!rows.length) rows.push('<li class="muted">남은 순서가 없습니다.</li>');
  return `<ol class="order-list">${rows.join('')}</ol>`;
}

/** 운영 화면용 — 완료된 낙찰까지 포함 */
const queue = {
  render({ state, d }) {
    const title = state.phase === 'rebid' ? '유찰 경매 순서' : '경매 순서';
    return panel(title, `<div class="panel-body" data-scroll-current>${renderLineup(state, d, { showDone: true })}</div>`,
      `<span class="num">${Math.min(state.cursor + 1, d.queue.length)} / ${d.queue.length}</span>`);
  },
};

/** 방송 오버레이용 — 현재 + 다음 순서 + 유찰(맨 뒤)만 */
const upcoming = {
  render({ state, d }) {
    const left = d.queue.length - state.cursor - 1;
    const title = state.phase === 'rebid' ? '유찰 경매 순서' : '다음 경매 순서';
    return panel(title, `<div class="panel-body">${renderLineup(state, d, { showDone: false })}</div>`,
      `<span class="num">남은 ${Math.max(0, left)}명</span>`);
  },
};

// ── 감독 목록 / 실시간 크레딧 ──
// 카드 = [정보: 아바타·이름·크레딧] + [영입한 스트리머 칸 3개]
// 감독 패널에서는 한 줄에 한 명(.rows), '내 팀' 패널에서는 세로 카드로 표시
/** 옵저버 정정 — 낙찰 취소 버튼 (경매 중 · 경매 종료 후) */
const revokeBtn = (state, role, s) => role === 'observer' && ['auction', 'rebid', 'result'].includes(state.phase)
  ? `<button class="slot-x" data-action="revoke" data-id="${s.id}" title="${esc(s.name)} 낙찰 취소 (크레딧 환급 후 유찰 경매에서 다시)">✕</button>` : '';

function directorCard(dir, { state, d, role }, { manage = false } = {}) {
  const c = state.current;
  const leading = c && c.highBidderId === dir.id;
  const held = d.held(dir);
  const slots = Array.from({ length: state.settings.teamSize }, (_, i) => {
    const s = d.byId[dir.roster[i]];
    return s
      ? `<div class="roster-slot filled">${avatar(s, { square: true })}<span class="sname">${esc(s.name)}</span>${manage ? revokeBtn(state, role, s) : ''}</div>`
      : `<div class="roster-slot"></div>`;
  }).join('');
  const cls = ['director-card', leading && 'is-leading', d.isFull(dir) && 'is-full', !dir.connected && 'is-off'].filter(Boolean).join(' ');
  const tools = manage ? `
      ${state.phase === 'prep' ? `<button class="btn btn-sm btn-ghost" data-action="kick" data-id="${dir.id}" title="내보내기">✕</button>` : ''}` : '';
  return `<div class="${cls}" style="--tc:${teamColor(dir)}">
    <div class="info">
      <div class="top">${avatar(dir, { size: 34, ring: teamColor(dir) })}
        <span class="dname">${esc(dir.name)}</span>
        ${dir.bot ? '<span class="badge" title="자동 입찰 봇">🤖 BOT</span>' : ''}
        ${!dir.connected ? '<span class="badge">OFF</span>' : ''}
        ${manage && !dir.bot ? `<button class="badge cam-btn ${dir.cam ? 'cyan' : 'unsold'}" data-action="setCam" data-id="${dir.id}" title="${esc(dir.cam || '캠 미등록')} — 클릭해서 등록/수정">CAM</button>` : ''}
        ${tools}
      </div>
      <div class="row"><span class="points num">${cr(d.available(dir))}</span>
        ${held ? `<span class="held num">입찰 중 ${cr(held)}</span>` : ''}
        ${d.isFull(dir) ? '<span class="badge cyan">완성</span>' : ''}</div>
    </div>
    <div class="roster-slots">${slots}</div>
  </div>`;
}
const directors = {
  render(ctx) {
    const { state, role } = ctx;
    const manage = role === 'observer';
    const cards = state.directors.map(dir => directorCard(dir, ctx, { manage })).join('');
    const empty = Array.from({ length: Math.max(0, state.rules.maxDirectors - state.directors.length) },
      () => `<div class="director-card is-empty"><div class="info"><div class="top"><div class="avatar" style="--size:34px;background:var(--panel-2)">?</div><span class="dname muted">대기 중…</span></div></div></div>`).join('');
    return panel(`감독 (${state.directors.length}/${state.rules.maxDirectors})`,
      `<div class="panel-body"><div class="director-grid rows">${cards}${state.phase === 'prep' ? empty : ''}</div></div>`);
  },
};

// ── 내 정보 (감독) ──
const me = {
  render(ctx) {
    const { me, state } = ctx;
    if (!me) return panel('내 정보', '<div class="muted">시청 모드입니다.</div>');
    return panel('내 팀', `
      ${directorCard(me, ctx)}
      ${state.phase === 'prep' ? `<button class="btn btn-sm" data-action="myImage">프로필 사진 변경</button>` : ''}
      ${state.phase !== 'result' ? camSetup(me) : ''}
      ${state.phase === 'prep' ? `<div class="muted" style="font-size:13px">옵저버가 경매를 시작하면 자동으로 경매 화면으로 넘어갑니다.</div>` : ''}`);
  },
};

/** vdo.ninja 시청 링크에서 스트림 ID 추출 */
export function vdoId(url) {
  try {
    const u = new URL(url);
    return /(^|\.)vdo\.ninja$/.test(u.hostname) ? u.searchParams.get('view') : null;
  } catch { return null; }
}

// 감독 캠 등록 (내 팀 패널 안)
function camSetup(me) {
  const id = me.cam && vdoId(me.cam);
  return `<div class="cam-setup">
    <div class="row" style="justify-content:space-between">
      <b>캠 화면</b>${me.cam ? '<span class="badge cyan">등록됨</span>' : '<span class="badge unsold">미등록</span>'}
    </div>
    <div class="row wrap">
      <button class="btn btn-primary btn-sm" data-action="camCreate">📷 ${me.cam ? '캠 새로 연결하기' : '내 캠 연결하기'}</button>
      ${id ? `<a class="btn btn-sm" href="${esc(CAM.pushUrl(id))}" target="_blank" rel="noopener">송출 페이지 다시 열기</a>` : ''}
      ${me.cam ? `<a class="btn btn-sm" href="${esc(me.cam)}" target="_blank" rel="noopener">미리보기</a>
        <button class="btn btn-sm btn-ghost" data-action="camClear">해제</button>` : ''}
    </div>
    <div class="row">
      <input class="input" data-keep="camLink" placeholder="또는 vdo.ninja 시청 링크 붙여넣기 (https://vdo.ninja/?view=…)">
      <button class="btn btn-sm" data-action="camSave">저장</button>
    </div>
    <div class="muted" style="font-size:12px">‘내 캠 연결하기’를 누르면 열리는 창에서 카메라를 선택하고 <b>그 창을 계속 열어두세요.</b> 입찰하면 방송에 내 캠이 나옵니다.</div>
  </div>`;
}

// ── 감독 캠 (최고 입찰자의 캠 표시) ──
// iframe 은 한 번 만든 뒤 숨김/표시만 바꿔서 재접속 없이 즉시 전환
function camSrc(url) {
  if (!vdoId(url)) return url;
  const extra = CAM.viewParams.split('&').filter(p => p && !url.includes(p.split('=')[0]));
  return extra.length ? `${url}&${extra.join('&')}` : url;
}
const cam = {
  className: 'cam',
  mount(el) {
    el.innerHTML = `<div class="cam-stage"></div><div class="cam-empty"></div><div class="cam-label"></div>`;
    el._frames = new Map();
  },
  update(el, { state, d }) {
    const stage = el.querySelector('.cam-stage');
    const frames = el._frames;
    const c = state.current;
    const leader = c?.highBidderId ? d.dirById[c.highBidderId] : null;
    const want = new Map(state.directors.filter(x => x.cam).map(x => [x.id, camSrc(x.cam)]));
    for (const [id, f] of frames) {
      if (want.get(id) !== f.dataset.src) { f.remove(); frames.delete(id); }
    }
    for (const [id, src] of want) {
      if (frames.has(id) || (!CAM.preload && id !== leader?.id)) continue;
      const f = document.createElement('iframe');
      f.src = src;
      f.dataset.src = src;
      f.allow = 'autoplay; fullscreen';
      f.setAttribute('allowtransparency', 'true');
      stage.appendChild(f);
      frames.set(id, f);
    }
    const showing = leader && frames.has(leader.id) ? leader : null;
    for (const [id, f] of frames) f.classList.toggle('on', id === showing?.id);

    el.style.setProperty('--tc', teamColor(leader));
    el.classList.toggle('has-leader', !!leader);
    el.querySelector('.cam-label').innerHTML = leader
      ? `${avatar(leader, { size: 30, ring: teamColor(leader) })}<span>${esc(leader.name)}</span><span class="amt">${cr(c.highBid)}</span>` : '';
    el.querySelector('.cam-empty').textContent =
      !c ? '' : !leader ? '입찰 대기 중' : leader.bot ? `🤖 ${leader.name} 입찰 중` : !leader.cam ? `${leader.name} 감독 캠 미등록` : '';
  },
};

/** dak.gg 평가 요약 (최고 RP + 그 시즌 모스트 3 / 현재 RP · 평균 TK · 평균 순위) */
export function statsLine(s) {
  const st = s?.stats;
  if (!st || st.noData) return '';
  const season = n => n ? ` <span class="muted">(시즌 ${n})</span>` : '';
  // 최고 RP 시즌 줄: 최고 RP + 그 시즌 모스트 / 현재 시즌 줄: 현재 RP + 평균 TK · 평균 순위
  return `<div class="lot-stats lot-most">최고 RP <b class="num">${fmt(st.rp)}</b>${season(st.bestSeason)}${st.most?.length ? ` · 모스트 ${mostPicks(st.most)}` : ''}</div>
    <div class="lot-stats">${st.curRp != null ? `현재 RP <b class="num">${fmt(st.curRp)}</b>${season(st.curSeason)} · ` : ''}평균 TK <b class="num">${st.tk.toFixed(2)}</b> · 평균 순위 <b class="num">${st.rank.toFixed(2)}</b></div>`;
}

// ── 현재 경매 대상 ──
const lot = {
  className: 'lot',
  render({ state, d }) {
    const c = state.current;
    const s = d.currentStreamer;
    if (!s) return `<div class="muted" style="font-size:20px">다음 경매 준비 중…</div>`;
    const leader = d.leader;
    const isReveal = c.status === 'reveal';
    let stamp = '';
    if (state.paused) stamp = `<div class="stamp-dim"></div><div class="stamp paused">⏸ 일시 정지</div>`;
    else if (isReveal) stamp = c.result === 'sold'
      ? `<div class="stamp-dim"></div><div class="stamp sold">${esc(leader?.name)} 팀 낙찰!</div>`
      : `<div class="stamp-dim"></div><div class="stamp unsold">유찰</div>`;
    const status = state.phase === 'rebid' ? '<span class="badge red">유찰 경매</span>' : `<span class="badge">#${state.cursor + 1}</span>`;
    return `
      <div class="status">${status}</div>
      ${avatar(s, { square: true, ring: leader ? teamColor(leader) : undefined })}
      <div class="lot-name">${esc(s.name)}</div>
      ${statsLine(s)}
      <div class="lot-meta">최소 입찰 <span class="num">${cr(d.minBidOf(s))}</span> · 입찰 <span class="num">${c.bidCount}</span>회</div>
      <div class="price">${c.highBid !== null ? cr(c.highBid) : '–'}</div>
      <div class="leader" style="color:${teamColor(leader)}">${leader ? `${esc(leader.name)} 최고 입찰` : '입찰 대기'}</div>
      ${isReveal ? '' : timerHtml()}
      ${stamp}`;
  },
};
export const timerHtml = () =>
  `<div class="timer" data-timer><div class="timer-num num" data-timer-num>–</div><div class="timer-bar"><i data-timer-bar></i></div></div>`;

/** 매 프레임 타이머 요소 갱신 (재렌더링 없이) */
export function tickTimers(root, state) {
  const c = state?.current;
  const ms = remainingMs(state);
  root.querySelectorAll('[data-timer]').forEach(t => {
    const num = t.querySelector('[data-timer-num]');
    const bar = t.querySelector('[data-timer-bar]');
    if (num) num.textContent = c ? (ms / 1000).toFixed(1) : '–';
    if (bar) bar.style.transform = `scaleX(${c ? Math.min(1, ms / (c.durationMs || 1)) : 0})`;
    t.classList.toggle('is-urgent', !!c && ms < 3000);
  });
}

// ── 입찰 박스 (감독) ──
const bid = {
  className: 'bid',
  render({ state, d, me }) {
    const c = state.current;
    const s = d.currentStreamer;
    let reason = '';
    if (!me) reason = '시청 모드';
    else if (!c || c.status !== 'bidding') reason = '다음 경매를 기다리는 중';
    else if (state.paused) reason = '일시 정지 중';
    else if (d.isFull(me)) reason = `팀 구성 완료 (${state.settings.teamSize}명) — 더 이상 입찰할 수 없습니다`;
    else if (c.highBidderId === me.id) reason = '현재 최고 입찰자입니다';
    const minNext = s ? Math.max(d.minBidOf(s), c.highBid !== null ? c.highBid + 10 : 0) : 0;
    const max = me ? d.maxBid(me) : 0;   // 남은 팀원 자리 몫을 뺀 최대 입찰 가능액
    const can = !reason && me && minNext <= max;
    if (!reason && me && minNext > max) reason = d.reserve(me) && minNext <= me.points
      ? `남은 팀원 자리를 위해 ${cr(d.reserve(me))}을 남겨야 합니다 (최대 ${cr(max)})`
      : `보유 ${CURRENCY.name} 부족`;
    const dis = can ? '' : 'disabled';
    const reserveNote = me && !d.isFull(me) && d.reserve(me)
      ? `<div class="muted" style="font-size:12px">남은 팀원 ${state.settings.teamSize - me.roster.length - 1}자리 몫 <span class="num">${cr(d.reserve(me))}</span> 보존 · 최대 입찰 <b class="num">${cr(max)}</b></div>` : '';
    return panel('입찰', `
      <div class="row muted" style="justify-content:space-between">
        <span>보유 ${CURRENCY.name} <b class="num" style="color:var(--accent-hi)">${cr(me ? d.available(me) : 0)}</b></span>
        <span>다음 최소 <b class="num">${cr(minNext)}</b></span>
      </div>
      ${reserveNote}
      <div class="bid-row">
        <input class="input num grow" type="number" step="10" min="${minNext}" max="${max}" placeholder="${minNext}"
          data-keep="bidAmount" data-min="${minNext}" ${dis}>
        <button class="btn btn-primary btn-lg" data-action="bid" ${dis}>입찰</button>
      </div>
      <div class="quick">
        <button class="btn btn-sm" data-action="bidQuick" data-v="${minNext}" ${dis}>최소 <span class="num">${fmt(minNext)}</span></button>
        ${[10, 50, 100, 200].map(v => `<button class="btn btn-sm num" data-action="bidAdd" data-v="${v}" ${dis}>+${v}</button>`).join('')}
        <button class="btn btn-sm" data-action="bidQuick" data-v="${max}" ${dis} title="남은 팀원 자리 몫을 뺀 최대치">올인 <span class="num">${fmt(max)}</span></button>
      </div>
      <div class="reason">${reason}</div>`);
  },
};

// ── 진행 컨트롤 (옵저버 준비 단계 — 경매 중 일시 정지/재진행은 헤더에 있음) ──
const controls = {
  render({ state }) {
    const cams = state.directors.filter(x => x.cam).length;
    return panel('진행', `
      <div class="row wrap"><button class="btn btn-primary btn-lg" data-action="start">▶ 경매 시작</button>
        ${state.directors.length < state.rules.maxDirectors ? `<button class="btn" data-action="fillBots" title="빈 감독 자리를 자동 입찰 봇으로 채웁니다 (dak.gg 기록 기반 평가)">🤖 빈 자리 봇으로 채우기</button>` : ''}</div>
      <div class="muted">감독 <span class="num">${state.directors.length} / ${state.rules.maxDirectors}</span> · 캠 등록 <span class="num">${cams} / ${state.directors.length}</span>
        ${state.directors.some(x => x.bot) ? ` · 봇 <span class="num">${state.directors.filter(x => x.bot).length}</span>명 (✕ 로 빼기)` : ''}</div>`);
  },
};

// ── 경매 로그 (채팅형 — 증분 추가로 애니메이션 유지) ──
const LOG_MAX_DOM = 40;
const log = {
  mount(el) {
    el.innerHTML = panel('경매 로그', '<div class="log-feed"></div>');
    el._seen = new Set();
  },
  update(el, { state, d }) {
    const feed = el.querySelector('.log-feed');
    const items = state.log.slice(-LOG_MAX_DOM);
    // 처음 렌더링이면 애니메이션 없이 채움
    const first = el._seen.size === 0;
    for (const e of items) {
      if (el._seen.has(e.id)) continue;
      el._seen.add(e.id);
      const dir = e.directorId ? d.dirById[e.directorId] : null;
      const node = document.createElement('div');
      node.className = `log-item type-${e.type}`;
      if (first) node.style.animation = 'none';
      if (dir) node.style.setProperty('--tc', teamColor(dir));
      const time = new Date(e.t).toLocaleTimeString('ko-KR', { hour12: false });
      const amt = e.type === 'bid' ? `<span class="amt">${cr(e.amount)}</span>` : '';
      const text = e.type === 'bid' ? esc(dir?.name ?? '') : esc(e.text);
      node.innerHTML = `${dir ? avatar(dir, { ring: teamColor(dir) }) : ''}<span>${text}</span>${amt}<span class="t">${time}</span>`;
      if (e.type === 'bid') node.querySelector('.t').remove();
      feed.appendChild(node);
    }
    while (feed.children.length > LOG_MAX_DOM) feed.firstChild.remove();
  },
};

// ── 결과: 팀 구성 ──
const teams = {
  render({ state, d, role }) {
    const cards = state.directors.map(dir => {
      const members = Array.from({ length: state.settings.teamSize }, (_, i) => {
        const s = d.byId[dir.roster[i]];
        return s
          ? `<div class="team-member">${avatar(s, { square: true })}<span class="mname">${esc(s.name)}</span><span class="price num">${cr(s.price)}</span>${revokeBtn(state, role, s)}</div>`
          : `<div class="team-member empty">빈 자리</div>`;
      }).join('');
      const spent = dir.roster.reduce((a, id) => a + (d.byId[id]?.price || 0), 0);
      return `<div class="team-card" style="--tc:${teamColor(dir)}">
        <div class="team-head">${avatar(dir, { ring: teamColor(dir) })}<div><div class="team-name">${esc(dir.name)} 팀</div>
        <div class="muted">사용 <span class="num">${cr(spent)}</span> · 잔여 <span class="num">${cr(dir.points)}</span></div></div></div>${members}</div>`;
    }).join('');
    return panel('최종 팀 구성', `<div class="panel-body"><div class="team-grid">${cards}</div></div>`);
  },
};

const unassigned = {
  render({ state }) {
    const left = state.streamers.filter(s => s.status !== 'sold');
    if (!left.length) return panel('', '<div class="muted" style="text-align:center">🎉 모든 스트리머가 팀에 배정되었습니다.</div>');
    return panel(`미배정 스트리머 (${left.length})`,
      `<div class="row wrap">${left.map(s => `<span class="badge unsold">${esc(s.name)}</span>`).join('')}</div>`);
  },
};

export const PANELS = { header, share, order, queue, upcoming, directors, me, lot, bid, controls, cam, log, teams, unassigned };
