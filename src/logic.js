// 경매 규칙 로직 — 플랫폼과 무관한 순수 함수 모음. 모든 판정은 서버(Durable Object)에서 이 파일로 한다.

// ── 화폐 용어 (화면 쪽은 public/js/config.js 의 CURRENCY 와 맞춰주세요) ──
export const CURRENCY = { name: '크레딧', unit: 'CR' };
const fmtc = n => `${Number(n).toLocaleString('ko-KR')} ${CURRENCY.unit}`;

// ── 규칙 상수 (요구사항 기준) ─────────────────────────────
export const RULES = {
  maxStreamers: 24,
  maxDirectors: 8,
  teamSize: 3,            // 팀당 스트리머 수 (24 / 8)
  bidStep: 10,            // 입찰 단위
  minBid: 10,             // 모든 스트리머 최소 입찰가 (유찰 경매 포함). 남은 팀원 자리마다 이만큼은 남겨둬야 한다
  timerMin: 5, timerMax: 20,
  pointsMin: 500, pointsMax: 2000,
  bidResetSec: 10,        // 상위 입찰 발생 시 타이머 리셋 값
  revealMs: 3000,         // 낙찰/유찰 결과를 보여주는 시간
  logLimit: 300,
};

// ── 유틸 ─────────────────────────────────────────────────
export function uid(bytes = 8) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}
const randInt = n => crypto.getRandomValues(new Uint32Array(1))[0] % n;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export function roomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[randInt(chars.length)]).join('');
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = randInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ── 상태 접근 ─────────────────────────────────────────────
const getStreamer = (room, id) => room.streamers.find(s => s.id === id);
const getDirector = (room, id) => room.directors.find(d => d.id === id);
const isFull = (room, d) => d.roster.length >= room.settings.teamSize;
const eligibleDirectors = room => room.directors.filter(d => !isFull(room, d));
const running = room => room.phase === 'auction' || room.phase === 'rebid';
/** 이번 입찰에 쓸 수 있는 최대치 = 보유 - (이번 영입 후 남는 팀원 자리 × 최소 입찰가) */
const reserveFor = (room, d) => Math.max(0, room.settings.teamSize - d.roster.length - 1) * RULES.minBid;
const maxBidOf = (room, d) => Math.max(0, d.points - reserveFor(room, d));
const minBidOf = s => Math.max(RULES.minBid, s.minBid || 0);

/** 클라이언트로 보내는 공개 상태 (토큰·옵저버 키 제외) */
export function publicState(room, now) {
  const { observerKey, ...rest } = room;
  return { ...rest, directors: room.directors.map(({ token, ...d }) => d), serverNow: now, rules: RULES };
}
function log(room, now, type, text, extra = {}) {
  room.log.push({ id: uid(4), t: now, type, text, ...extra });
  if (room.log.length > RULES.logLimit) room.log.splice(0, room.log.length - RULES.logLimit);
}

// ── 룸 생성 ──────────────────────────────────────────────
export function createRoom(b, code, now) {
  const names = (b.streamers || []).map(s => ({ name: String(s.name || '').trim().slice(0, 30), image: s.image || null })).filter(s => s.name);
  if (!names.length) return { error: '스트리머를 1명 이상 등록하세요.' };
  if (names.length > RULES.maxStreamers) return { error: `스트리머는 최대 ${RULES.maxStreamers}명입니다.` };
  const room = {
    code,
    title: String(b.title || '팀 경매').slice(0, 40),
    observerKey: uid(12),
    createdAt: now,
    settings: {
      timerSec: clamp(Math.round(+b.timerSec || 10), RULES.timerMin, RULES.timerMax),
      startPoints: clamp(Math.round((+b.startPoints || 1000) / RULES.bidStep) * RULES.bidStep, RULES.pointsMin, RULES.pointsMax),
      teamSize: RULES.teamSize,
      bidResetSec: RULES.bidResetSec,
    },
    phase: 'prep',            // prep → auction → rebid → result
    paused: false,
    streamers: names.map(s => ({ id: uid(4), name: s.name, image: s.image, minBid: RULES.minBid, status: 'pending', teamId: null, price: null })),
    order: [],
    cursor: -1,
    unsoldQueue: [],
    passUnsold: [],
    passSold: 0,
    directors: [],
    current: null,
    log: [],
  };
  room.order = room.streamers.map(s => s.id);
  log(room, now, 'system', `룸 생성: ${room.title}`);
  return { room };
}

// ── 경매 진행 ─────────────────────────────────────────────
function startLot(room, now, streamerId) {
  const s = getStreamer(room, streamerId);
  room.current = {
    streamerId,
    status: 'bidding',          // bidding → reveal
    highBid: null,
    highBidderId: null,
    endsAt: now + room.settings.timerSec * 1000,
    durationMs: room.settings.timerSec * 1000,   // 타이머 바 표시용
    pausedRemainingMs: null,
    bidCount: 0,
  };
  const tag = room.phase === 'rebid' ? '[유찰 경매] ' : '';
  log(room, now, 'lot', `${tag}${s.name} 경매 시작! (최소 ${fmtc(minBidOf(s))})`, { streamerId });
}

function resolveLot(room, now) {
  const c = room.current;
  const s = getStreamer(room, c.streamerId);
  if (c.highBidderId) {
    const d = getDirector(room, c.highBidderId);
    d.points -= c.highBid;             // 최종 차감 (입찰 중에는 '보류'로만 표시됨)
    d.roster.push(s.id);
    s.status = 'sold'; s.teamId = d.id; s.price = c.highBid;
    c.result = 'sold';
    if (room.phase === 'rebid') room.passSold++;
    log(room, now, 'sold', `${s.name} → ${d.name} 팀 낙찰! (${fmtc(c.highBid)})`, { streamerId: s.id, directorId: d.id, amount: c.highBid });
  } else {
    s.status = 'unsold';
    c.result = 'unsold';
    room.passUnsold.push(s.id);
    log(room, now, 'unsold', `${s.name} 유찰`, { streamerId: s.id });
  }
  c.status = 'reveal';
  c.endsAt = now + RULES.revealMs;
  c.durationMs = RULES.revealMs;
}

function nextLot(room, now) {
  room.current = null;
  if (room.phase === 'auction') {
    room.cursor++;
    if (room.cursor < room.order.length && eligibleDirectors(room).length) {
      return startLot(room, now, room.order[room.cursor]);
    }
    // 본 경매 종료 → 유찰 경매로
    room.unsoldQueue = room.passUnsold.slice();
    room.passUnsold = [];
    room.passSold = 0;
    if (room.unsoldQueue.length && eligibleDirectors(room).length) {
      room.phase = 'rebid';
      room.cursor = 0;
      log(room, now, 'system', `본 경매 종료. 유찰 경매 시작 (${room.unsoldQueue.length}명)`);
      return startLot(room, now, room.unsoldQueue[0]);
    }
    return finish(room, now);
  }
  if (room.phase === 'rebid') {
    room.cursor++;
    if (!eligibleDirectors(room).length) return finish(room, now);
    if (room.cursor < room.unsoldQueue.length) return startLot(room, now, room.unsoldQueue[room.cursor]);
    // 한 바퀴 종료: 낙찰이 한 번이라도 있었다면 남은 유찰자로 다시 한 바퀴
    if (room.passUnsold.length && room.passSold > 0) {
      room.unsoldQueue = room.passUnsold.slice();
      room.passUnsold = []; room.passSold = 0; room.cursor = 0;
      log(room, now, 'system', `유찰 경매 재순환 (${room.unsoldQueue.length}명)`);
      return startLot(room, now, room.unsoldQueue[0]);
    }
    return finish(room, now);
  }
}

function finish(room, now) {
  room.phase = 'result';
  room.current = null;
  room.paused = false;
  const left = room.streamers.filter(s => s.status !== 'sold');
  left.forEach(s => (s.status = 'unassigned'));
  log(room, now, 'system', left.length ? `경매 종료 — 미배정 ${left.length}명` : '경매 종료 — 모든 스트리머 배정 완료!');
}

/** 타이머 만료 처리. 상태가 바뀌었으면 true */
export function tick(room, now) {
  let changed = false;
  while (room && running(room) && !room.paused && room.current && now >= room.current.endsAt) {
    if (room.current.status === 'bidding') resolveLot(room, now);
    else nextLot(room, now);
    changed = true;
  }
  return changed;
}

/** 다음으로 깨어나야 할 시각 (알람용) */
export function nextDeadline(room) {
  return room && running(room) && !room.paused && room.current ? room.current.endsAt : null;
}

// ── 감독 등록 ─────────────────────────────────────────────
export function registerDirector(room, now, { name, image } = {}) {
  if (room.phase !== 'prep') return { error: '경매가 이미 시작되었습니다.' };
  name = String(name || '').trim().slice(0, 16);
  if (!name) return { error: '닉네임을 입력하세요.' };
  if (room.directors.length >= RULES.maxDirectors) return { error: `감독은 최대 ${RULES.maxDirectors}명입니다.` };
  if (room.directors.some(d => d.name === name)) return { error: '이미 사용 중인 닉네임입니다.' };
  const director = {
    id: uid(4), token: uid(12), name, image: image || null,
    slot: room.directors.length, points: room.settings.startPoints, roster: [], connected: true,
    cam: null,   // 캠 화면 링크 (예: https://vdo.ninja/?view=XXXX)
  };
  room.directors.push(director);
  log(room, now, 'join', `${name} 감독 입장`, { directorId: director.id });
  return { director };
}

// ── 액션 처리 ─────────────────────────────────────────────
// actor = { role: 'observer'|'director'|'viewer', directorId }
// 반환: 오류 메시지 문자열, 또는 성공 시 null
// 캠 링크 검사: 빈 값 → null(해제), https 주소 → 저장, 그 외 → undefined(오류)
const CAM_ERROR = '캠 링크는 https:// 로 시작하는 주소여야 합니다.';
function cleanCam(v) {
  v = String(v ?? '').trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && v.length <= 500 ? u.toString() : undefined;
  } catch { return undefined; }
}

const OBSERVER_ACTIONS = {
  // 옵저버가 감독 대신 캠 링크를 등록/수정 (경매 중에도 가능)
  'director:setCam'(room, now, { id, cam }) {
    const d = getDirector(room, id);
    if (!d) return '감독을 찾을 수 없습니다.';
    const c = cleanCam(cam);
    if (c === undefined) return CAM_ERROR;
    d.cam = c;
  },
  'prep:setOrder'(room, now, { order }) {
    if (room.phase !== 'prep') return '준비 단계에서만 가능합니다.';
    const ids = new Set(room.streamers.map(s => s.id));
    if (!Array.isArray(order) || order.length !== ids.size || !order.every(id => ids.has(id))) return '잘못된 순서입니다.';
    room.order = order.slice();
  },
  'prep:shuffle'(room, now) {
    if (room.phase !== 'prep') return '준비 단계에서만 가능합니다.';
    shuffle(room.order);
    log(room, now, 'system', '경매 순서 무작위 섞기');
  },
  'prep:setMinBid'(room, now, { id, minBid }) {
    if (room.phase !== 'prep') return '준비 단계에서만 가능합니다.';
    const s = getStreamer(room, id);
    if (!s) return '스트리머를 찾을 수 없습니다.';
    s.minBid = clamp(Math.round((+minBid || 0) / RULES.bidStep) * RULES.bidStep, RULES.minBid, room.settings.startPoints);
  },
  'prep:setStreamerImage'(room, now, { id, image }) {
    const s = getStreamer(room, id);
    if (!s) return '스트리머를 찾을 수 없습니다.';
    s.image = image || null;
  },
  'prep:kick'(room, now, { id }) {
    if (room.phase !== 'prep') return '준비 단계에서만 가능합니다.';
    const d = getDirector(room, id);
    if (!d) return '감독을 찾을 수 없습니다.';
    room.directors = room.directors.filter(x => x.id !== id);
    room.directors.forEach((x, i) => (x.slot = i));
    log(room, now, 'system', `${d.name} 감독 퇴장 처리`);
  },
  'auction:start'(room, now) {
    if (room.phase !== 'prep') return '이미 시작되었습니다.';
    if (!room.directors.length) return '입장한 감독이 없습니다.';
    room.phase = 'auction';
    room.cursor = 0;
    room.paused = false;
    log(room, now, 'system', `경매 시작! 감독 ${room.directors.length}명 · 스트리머 ${room.order.length}명`);
    startLot(room, now, room.order[0]);
  },
  'auction:pause'(room, now) {
    if (!running(room)) return '경매 중이 아닙니다.';
    if (room.paused) return '이미 일시 정지 상태입니다.';
    room.paused = true;
    if (room.current) room.current.pausedRemainingMs = Math.max(0, room.current.endsAt - now);
    log(room, now, 'system', '경매 일시 정지');
  },
  'auction:resume'(room, now) {
    if (!room.paused) return '일시 정지 상태가 아닙니다.';
    room.paused = false;
    if (room.current) {
      room.current.endsAt = now + (room.current.pausedRemainingMs ?? 0);
      room.current.pausedRemainingMs = null;
    }
    log(room, now, 'system', '경매 재진행');
  },
};

const DIRECTOR_ACTIONS = {
  // 보낸 항목만 바꾼다 (사진만 바꿀 때 캠 링크가 지워지지 않도록)
  'director:update'(room, now, p, director) {
    if ('image' in p) director.image = p.image || null;
    if ('cam' in p) {
      const cam = cleanCam(p.cam);
      if (cam === undefined) return CAM_ERROR;
      director.cam = cam;
    }
  },
  bid(room, now, { amount }, director) {
    const c = room.current;
    if (!c || c.status !== 'bidding' || !running(room)) return '입찰 가능한 시간이 아닙니다.';
    if (room.paused) return '경매가 일시 정지 중입니다.';
    if (now >= c.endsAt) return '입찰 시간이 종료되었습니다.';
    if (isFull(room, director)) return `이미 ${room.settings.teamSize}명을 영입했습니다.`;
    if (c.highBidderId === director.id) return '이미 최고 입찰자입니다.';
    amount = Math.round(+amount);
    const s = getStreamer(room, c.streamerId);
    if (!Number.isFinite(amount) || amount <= 0 || amount % RULES.bidStep) return `${fmtc(RULES.bidStep)} 단위로 입찰하세요.`;
    if (amount < minBidOf(s)) return `최소 입찰가는 ${fmtc(minBidOf(s))} 입니다.`;
    if (c.highBid !== null && amount <= c.highBid) return `현재 최고가(${fmtc(c.highBid)})보다 높게 입찰하세요.`;
    if (amount > director.points) return `보유 ${CURRENCY.name}이 부족합니다.`;
    if (amount > maxBidOf(room, director))
      return `남은 팀원 자리를 위해 ${fmtc(reserveFor(room, director))}을 남겨야 합니다. (최대 ${fmtc(maxBidOf(room, director))})`;

    c.highBid = amount;
    c.highBidderId = director.id;   // 이전 최고 입찰자의 보류 크레딧은 자동 반환 (보류 = 최고입찰액)
    c.bidCount++;
    c.endsAt = now + room.settings.bidResetSec * 1000;
    c.durationMs = room.settings.bidResetSec * 1000;
    log(room, now, 'bid', `${director.name}: ${fmtc(amount)}`, { directorId: director.id, amount, streamerId: s.id });
  },
};

export function handleAction(room, now, actor, ev, payload = {}) {
  if (OBSERVER_ACTIONS[ev]) {
    if (actor.role !== 'observer') return '옵저버 권한이 필요합니다.';
    return OBSERVER_ACTIONS[ev](room, now, payload || {}) || null;
  }
  if (DIRECTOR_ACTIONS[ev]) {
    const director = actor.role === 'director' && getDirector(room, actor.directorId);
    if (!director) return '감독만 가능합니다.';
    return DIRECTOR_ACTIONS[ev](room, now, payload || {}, director) || null;
  }
  return '알 수 없는 요청입니다.';
}
