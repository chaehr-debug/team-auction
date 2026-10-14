// 경매 규칙 로직 — 플랫폼과 무관한 순수 함수 모음. 모든 판정은 서버(Durable Object)에서 이 파일로 한다.
import { RATINGS, PERSONAS, personaValue } from './ratings.js';

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
const rand = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
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
  const { observerKey, botPlan, ...rest } = room;   // botPlan: 봇의 이번 경매 최대 입찰액 (비공개)
  return { ...rest, directors: room.directors.map(({ token, ...d }) => d), serverNow: now, rules: RULES };
}
function log(room, now, type, text, extra = {}) {
  room.log.push({ id: uid(4), t: now, type, text, ...extra });
  if (room.log.length > RULES.logLimit) room.log.splice(0, room.log.length - RULES.logLimit);
}

// 화면에 보여줄 dak.gg 평가 요약 (명단에 없는 이름이면 null)
function statsOf(name) {
  const r = RATINGS[name];
  return r ? { tier: r.tier, power: r.power, rp: r.rp, bestSeason: r.bestSeason, curRp: r.curRp, curSeason: r.curSeason, most: r.most, tk: r.tk, rank: r.rank, play: r.play, noData: r.noData } : null;
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
    streamers: names.map(s => ({ id: uid(4), name: s.name, image: s.image, minBid: RULES.minBid, status: 'pending', teamId: null, price: null, stats: statsOf(s.name) })),
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
    botAt: null,                // 다음 봇 판단 시각
  };
  const tag = room.phase === 'rebid' ? '[유찰 경매] ' : '';
  log(room, now, 'lot', `${tag}${s.name} 경매 시작! (최소 ${fmtc(minBidOf(s))})`, { streamerId });
  planBots(room, now);
}

// ── 봇 감독 ───────────────────────────────────────────────
// 매 경매마다 봇별 '최대 입찰액'을 정해두고, 1~3초 간격으로 그 안에서 조금씩 올려 입찰한다.
// 사람이 입찰하면 다시 판단한다.
//  1) 시세 = 아직 남은 크레딧 총합 × (이 스트리머 평가 가치 ÷ 남은 스트리머 평가 가치 합)
//     → 크레딧이 많이 남을수록 시세가 올라가 남은 크레딧을 끝까지 쓴다 (경매가 끝나면 남은 크레딧은 쓸모없음)
//  2) 유찰 작전 (본 경매): 뒤에 나올 더 강한 스트리머로 남은 자리를 충분히 채울 수 있으면
//     지금 나온 약한 스트리머는 건너뛰고 크레딧을 아낀다 → 유찰된 스트리머는 유찰 경매에서 싸게 채운다
//  3) 마지막 한 자리: 남은 매물 중 상위권이면 남은 크레딧을 몰아서 쓴다
//  성향(persona): 봇마다 중요하게 보는 기록이 달라 같은 매물도 다르게 평가한다 (src/ratings.js PERSONAS)
//     → 1)~3) 의 '평가 가치'는 모두 그 봇 성향의 기준가로 계산
const BOT = { passLine: [0.35, 0.7], bargainChance: 0.2, lastSlotAllIn: 2 };   // bargainChance: 건너뛸 때 최소가에 줍는 확률 (봇 전체 합)
const botValue = (room, s, b) => personaValue(b.persona || 'power', s.name, room.settings.startPoints);
const bots = room => room.directors.filter(d => d.bot && !isFull(room, d));
function botWillingness(room, b, s) {
  const slotsLeft = room.settings.teamSize - b.roster.length;
  const maxBid = maxBidOf(room, b);
  const open = room.directors.filter(d => !isFull(room, d));
  const openSlots = open.reduce((n, d) => n + room.settings.teamSize - d.roster.length, 0);
  const money = open.reduce((n, d) => n + d.points, 0);
  const left = room.streamers.filter(x => x.status !== 'sold');                   // 현재 매물 포함 (유찰자는 유찰 경매에 다시 나옴)
  const v = botValue(room, s, b);
  const market = money * v / (left.reduce((n, x) => n + botValue(room, x, b), 0) || 1);
  const rich = clamp((b.points / slotsLeft) / (money / openSlots), 0.5, 2.5);      // 남들보다 돈이 넉넉하면 그만큼 더 공격적
  let w = market * rich * (b.style || 1) * (0.85 + rand() * 0.3);

  if (room.phase === 'auction') {
    // 뒤에 나올, 지금 매물보다 강한 스트리머 수 ÷ 전체 빈자리. 높으면 지금 매물은 유찰 경매까지 남을 가능성이 큼
    const better = room.order.slice(room.cursor + 1).map(id => getStreamer(room, id))
      .filter(x => x.status === 'pending' && botValue(room, x, b) > v);
    const passLine = BOT.passLine[0] + rand() * (BOT.passLine[1] - BOT.passLine[0]) + ((b.style || 1) - 1) * 0.5;   // 공격적인 봇일수록 덜 건너뜀
    // 돈이 넉넉한 봇은 더 강한 스트리머가 충분히 남아 있으면 약한 매물로 자리를 채우지 않는다 (크레딧을 남기지 않도록)
    const saveForBetter = rich >= 1.3 && better.length >= slotsLeft * 3 && market < (b.points / slotsLeft) * 0.5;
    if (better.length / openSlots >= passLine || saveForBetter)
      return rand() < BOT.bargainChance / bots(room).length ? minBidOf(s) : 0;     // 건너뜀 (가끔 최소가에 줍기만)
  }
  if (slotsLeft === 1) {
    const stronger = left.filter(x => botValue(room, x, b) > v).length;
    w = Math.max(w, maxBid * clamp(1 - BOT.lastSlotAllIn * stronger / left.length, 0, 1));
  }
  if (room.phase === 'rebid') w = Math.max(w, minBidOf(s));                       // 유찰 경매: 남은 자리는 채운다
  return Math.min(maxBid, Math.floor(w / RULES.bidStep) * RULES.bidStep);
}
function planBots(room, now) {
  const s = getStreamer(room, room.current.streamerId);
  const bots = room.directors.filter(d => d.bot && !isFull(room, d));
  room.botPlan = bots.length ? { streamerId: s.id, will: Object.fromEntries(bots.map(b => [b.id, botWillingness(room, b, s)])) } : null;
  scheduleBots(room, now);
}
function scheduleBots(room, now) {
  const c = room.current;
  if (!c) return;
  c.botAt = room.botPlan && c.status === 'bidding'
    ? now + Math.round(Math.min(1200 + rand() * 2300, (c.endsAt - now) * 0.75)) : null;
}
function botAct(room, now) {
  const c = room.current, plan = room.botPlan;
  c.botAt = null;
  if (!plan || plan.streamerId !== c.streamerId) return;
  const s = getStreamer(room, c.streamerId);
  const next = c.highBid === null ? minBidOf(s) : c.highBid + RULES.bidStep;
  const cands = room.directors.filter(d => d.bot && !isFull(room, d) && c.highBidderId !== d.id && (plan.will[d.id] ?? 0) >= next);
  if (!cands.length) return;   // 이 가격이면 봇들은 포기 (사람이 입찰하면 다시 판단)
  const b = cands[randInt(cands.length)];
  const extra = Math.floor((plan.will[b.id] - next) * (0.1 + rand() * 0.3) / RULES.bidStep) * RULES.bidStep;
  placeBid(room, now, b, Math.min(next + extra, plan.will[b.id]));
}

/** 입찰 (사람·봇 공용). 오류 메시지 또는 null */
function placeBid(room, now, director, amount) {
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
  scheduleBots(room, now);
  return null;
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
  room.botPlan = null;
  room.finishedAt = now;   // 시세표 기록용 (worker 가 이 값으로 중복 기록을 막음)
  const left = room.streamers.filter(s => s.status !== 'sold');
  left.forEach(s => (s.status = 'unassigned'));
  log(room, now, 'system', left.length ? `경매 종료 — 미배정 ${left.length}명` : '경매 종료 — 모든 스트리머 배정 완료!');
}

/** 타이머 만료 처리. 상태가 바뀌었으면 true */
export function tick(room, now) {
  let changed = false;
  while (room && running(room) && !room.paused && room.current) {
    const c = room.current;
    if (now >= c.endsAt) {
      if (c.status === 'bidding') resolveLot(room, now);
      else nextLot(room, now);
    } else if (c.status === 'bidding' && c.botAt && now >= c.botAt) botAct(room, now);
    else break;
    changed = true;
  }
  return changed;
}

/** 다음으로 깨어나야 할 시각 (알람용) */
export function nextDeadline(room) {
  const c = room && running(room) && !room.paused && room.current;
  if (!c) return null;
  return c.status === 'bidding' && c.botAt ? Math.min(c.endsAt, c.botAt) : c.endsAt;
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

/** 낙찰 되돌리기: 크레딧 환급 · 팀에서 제외 */
function undoSale(room, s) {
  const d = getDirector(room, s.teamId);
  if (d) { d.points += s.price; d.roster = d.roster.filter(id => id !== s.id); }
  s.status = 'unsold'; s.teamId = null; s.price = null;
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
  // 빈 감독 자리를 봇으로 채움 (모의 경매용)
  'prep:fillBots'(room, now) {
    if (room.phase !== 'prep') return '준비 단계에서만 가능합니다.';
    const n = RULES.maxDirectors - room.directors.length;
    if (n <= 0) return '빈 감독 자리가 없습니다.';
    // 성향은 골고루 섞어서 배정 (지금 있는 봇 성향 수가 적은 것부터)
    const keys = Object.keys(PERSONAS);
    const nextPersona = () => {
      const count = k => room.directors.filter(d => d.persona === k).length;
      const least = Math.min(...keys.map(count));
      const pool = keys.filter(k => count(k) === least);
      return pool[Math.floor(rand() * pool.length)];
    };
    for (let k = 1, added = 0; added < n; k++) {
      const name = `봇 감독 ${k}`;
      if (room.directors.some(d => d.name === name)) continue;
      const persona = nextPersona();
      room.directors.push({
        id: uid(4), token: uid(12), name, image: null, slot: room.directors.length,
        points: room.settings.startPoints, roster: [], connected: true, cam: null,
        bot: true, style: +(0.85 + rand() * 0.35).toFixed(2),   // style: 공격성 (높을수록 비싸게 삼)
        persona, personaLabel: PERSONAS[persona].label,         // persona: 중요하게 보는 기록
      });
      added++;
    }
    log(room, now, 'system', `빈 자리 봇 감독 ${n}명 추가`);
  },
  // 정정: 현재 경매(입찰 중이거나 결과 표시 중)를 처음부터 다시
  'lot:restart'(room, now) {
    const c = room.current;
    if (!running(room) || !c) return '진행 중인 경매가 없습니다.';
    const s = getStreamer(room, c.streamerId);
    if (c.status === 'reveal') {
      if (c.result === 'sold') { undoSale(room, s); if (room.phase === 'rebid') room.passSold--; }
      else room.passUnsold = room.passUnsold.filter(id => id !== s.id);
    }
    s.status = room.phase === 'rebid' ? 'unsold' : 'pending';
    log(room, now, 'system', `옵저버 정정: ${s.name} 다시 경매`);
    startLot(room, now, s.id);
    if (room.paused) room.current.pausedRemainingMs = room.current.durationMs;
  },
  // 정정: 이미 끝난 낙찰 취소 → 크레딧 환급 후 유찰 경매에서 다시 (경매 종료 후면 유찰 경매를 다시 연다)
  'sale:revoke'(room, now, { id }) {
    const s = getStreamer(room, id);
    if (!s || s.status !== 'sold') return '낙찰된 스트리머가 아닙니다.';
    if (running(room) && room.current?.streamerId === id) return OBSERVER_ACTIONS['lot:restart'](room, now);
    if (!running(room) && room.phase !== 'result') return '경매 중에만 가능합니다.';
    const d = getDirector(room, s.teamId), price = s.price;
    undoSale(room, s);
    log(room, now, 'system', `옵저버 정정: ${s.name} 낙찰 취소 (${d?.name ?? '?'} 팀 ${fmtc(price)} 환급) — 유찰 경매에서 다시`);
    if (room.phase === 'auction') room.passUnsold.push(id);
    else if (room.phase === 'rebid') room.unsoldQueue.push(id);
    else {
      // 경매 종료 후: 취소한 스트리머 + 미배정 스트리머로 유찰 경매 재개
      const left = room.streamers.filter(x => x.status === 'unassigned');
      left.forEach(x => (x.status = 'unsold'));
      room.phase = 'rebid';
      room.paused = false;
      room.unsoldQueue = [id, ...left.map(x => x.id)];
      room.passUnsold = []; room.passSold = 0; room.cursor = 0;
      startLot(room, now, id);
    }
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
      scheduleBots(room, now);
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
    return placeBid(room, now, director, amount);
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
