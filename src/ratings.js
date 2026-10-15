// 스트리머 매물 평가 — dak.gg 기록(src/ratings-data.js)으로 '전력 점수'와 봇 감독의 기준가를 계산한다.
//
//  1) 라운드 기대 점수 = 평균 TK + 순위 점수(평균 순위를 대회 순위 점수표로 환산, 소수 순위는 사이 값)
//     순위 점수표: 1등 10 · 2등 7 · 3등 5 · 4등 4 · 5등 3 · 6등 2 · 7등 1 · 8등 0
//     판수가 적으면 우연이 크므로 전체 평균 쪽으로 당겨서 본다 (판수 / (판수 + 30) 만큼만 반영)
//  2) 기준 RP = 시즌 1~12 중 가장 높았던 RP
//  3) 전력 점수 = 기준 RP + 150 × (라운드 기대 점수 − 전체 평균)
//     → RP 가 높은 인원이 기본적으로 위. RP 차이가 수백 점 안쪽이면 TK·순위가 순서를 가른다
//        (라운드 기대 점수 1점 = RP 150점)
//  4) 기준가(시작 크레딧 1,000 기준): 전력이 높을수록 지수적으로 비싸짐, 평균 ≈ 시작 크레딧의 30%
import DATA, { FETCHED_AT } from './ratings-data.js';
import { STREAMER_NAMES } from './roster.js';

export const PLACE_POINTS = [10, 7, 5, 4, 3, 2, 1, 0];
export const FORMULA = { shrinkGames: 30, perfToRp: 150, priceCurve: 3, avgPriceShare: 0.3 };

/** 평균 순위(1~8, 소수) → 순위 점수 */
export function placePoints(avgRank) {
  const r = Math.min(8, Math.max(1, avgRank));
  const lo = Math.floor(r), hi = Math.ceil(r);
  const a = PLACE_POINTS[lo - 1], b = PLACE_POINTS[hi - 1];
  return a + (b - a) * (r - lo);
}

// 봇 감독 성향 — 같은 매물도 성향마다 다르게 평가해서 서로 다른 스트리머를 노린다
export const PERSONAS = {
  power: { label: '종합형', desc: '전력 점수(RP + TK·순위) 그대로' },
  rp: { label: 'RP 우선', desc: '순전히 시즌 최고 RP 가 높은 인원' },
  place: { label: '승률 우선', desc: '평균 순위(순위 점수)가 좋은 인원' },
  kill: { label: '킬 우선', desc: '평균 TK 가 높은 인원' },
  form: { label: '현재 폼 우선', desc: '이번 시즌 RP 가 높은 인원' },
};
const PERSONA_FOCUS = 0.75;   // 성향 기록 반영 비율 (나머지는 전력 점수) — RP 우선 · 종합형은 해당 값 100%
// 평판 보정 (봇 전용 · 화면/규칙/시세표에 표시하지 않음): 기록과 별개로 사람들이 고밸류로 보는 인원.
// 봇은 성향과 상관없이 아래 등급 순서로 평가한다 (같은 등급 안에서는 각 성향 점수 순, 명단에 없는 인원은 그 뒤).
//  1등급 HYPE: 서로 실력 차가 거의 없다고 보고 모두 같은 값(1~N위 값의 평균)으로 평가 → 누가 더 비싸지는 경매 순서에 달림
//  2등급 NEXT: HYPE 바로 다음 순위
const HYPE = ['피닉스박', '베릴', '갱맘', '이로클라우드', '플라이'];
const NEXT = ['네브짱'];

/** 점수 배열 → 시작 크레딧 1,000 기준 기준가 배열 (점수가 높을수록 지수적으로 비쌈, 평균 ≈ 시작 크레딧의 30%) */
function priceOf(scores) {
  const min = Math.min(...scores), max = Math.max(...scores);
  const w = scores.map(x => Math.exp(FORMULA.priceCurve * (x - min) / (max - min || 1)));
  const meanW = w.reduce((a, b) => a + b, 0) / w.length;
  return w.map(x => Math.max(10, Math.round(1000 * FORMULA.avgPriceShare * x / meanW / 10) * 10));
}

function build() {
  const rows = STREAMER_NAMES.map(name => ({ name, ...(DATA[name] || {}), noData: !DATA[name] }));
  const withData = rows.filter(r => !r.noData);
  const median = arr => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  // 기록이 없는 인원은 중앙값으로 대신 평가
  for (const r of rows) if (r.noData) Object.assign(r, { rp: median(withData.map(x => x.rp)), tk: median(withData.map(x => x.tk)), rank: median(withData.map(x => x.rank)), play: 0, curRp: null, bestSeason: null, most: [] });

  for (const r of rows) r.perfRaw = r.tk + placePoints(r.rank);
  const meanPerf = withData.reduce((s, r) => s + r.perfRaw, 0) / (withData.length || 1);
  for (const r of rows) {
    const k = r.play / (r.play + FORMULA.shrinkGames);
    r.perf = r.noData ? meanPerf : k * r.perfRaw + (1 - k) * meanPerf;
    r.power = Math.round(r.rp + FORMULA.perfToRp * (r.perf - meanPerf));
  }
  const sorted = [...rows].sort((a, b) => b.power - a.power);
  sorted.forEach((r, i) => { r.tier = i + 1; });
  // 시작 크레딧 1,000 기준 기준가 (10 단위)
  const values = priceOf(rows.map(r => r.power));
  rows.forEach((r, i) => { r.value1000 = values[i]; });

  // 봇 성향별 기준가: 성향마다 중요하게 보는 기록이 다르다 (판수가 적은 기록은 전체 평균 쪽으로 당김)
  const shrink = (r, key) => {
    const mean = withData.reduce((s, x) => s + x[key], 0) / (withData.length || 1);
    if (r.noData) return mean;
    const k = r.play / (r.play + FORMULA.shrinkGames);
    return k * r[key] + (1 - k) * mean;
  };
  for (const r of rows) r.placePts = placePoints(r.rank);
  for (const r of rows) { r.tkS = shrink(r, 'tk'); r.placeS = shrink(r, 'placePts'); r.cur = r.curRp ?? r.rp; }
  const z = arr => { const m = arr.reduce((a, b) => a + b, 0) / arr.length; const sd = Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length) || 1; return arr.map(x => (x - m) / sd); };
  const zPower = z(rows.map(r => r.power));
  // 성향 점수는 순서만 쓰고 전력 점수 분포에 다시 얹는다 → 성향마다 '누구를 더 쳐주나'만 달라지고 가격 분포는 같음
  const byPowerDesc = rows.map(r => r.power).sort((x, y) => y - x);
  const grade = rows.map(r => HYPE.includes(r.name) ? 0 : NEXT.includes(r.name) ? 1 : 2);
  const hypeScore = byPowerDesc.slice(0, HYPE.length).reduce((a, b) => a + b, 0) / HYPE.length;
  const reRank = sc => {
    const idx = sc.map((x, i) => i).sort((i, j) => grade[i] - grade[j] || sc[j] - sc[i]);
    const out = [];
    idx.forEach((i, k) => { out[i] = grade[i] === 0 ? hypeScore : byPowerDesc[k]; });
    return out;
  };
  const mix = key => reRank(z(rows.map(r => r[key])).map((x, i) => PERSONA_FOCUS * x + (1 - PERSONA_FOCUS) * zPower[i]));
  const personaScore = {
    power: reRank(rows.map(r => r.power)),
    rp: reRank(rows.map(r => r.rp)),
    place: mix('placeS'),
    kill: mix('tkS'),
    form: mix('cur'),
  };
  for (const [key, score] of Object.entries(personaScore)) {
    const v = priceOf(score);
    rows.forEach((r, i) => { (r.personaValue ||= {})[key] = v[i]; });
  }

  return Object.fromEntries(rows.map(r => [r.name, {
    nick: r.nick ?? null, rp: r.rp, bestSeason: r.bestSeason ?? null, curRp: r.curRp ?? null, curSeason: r.season ? (r.season - 17) / 2 : null,   // dak.gg seasonId 41 → 시즌 12
    tk: r.tk, rank: r.rank, play: r.play, noData: r.noData, most: r.most || [],
    placePts: +placePoints(r.rank).toFixed(2), perf: +r.perf.toFixed(2),
    power: r.power, tier: r.tier, value1000: r.value1000, personaValue: r.personaValue,
  }]));
}

export const RATINGS = build();
export const RATINGS_DATE = FETCHED_AT;

/** 시작 크레딧에 맞춘 기준가 */
export const baseValue = (name, startPoints) => Math.round((RATINGS[name]?.value1000 ?? 100) * startPoints / 1000);
/** 봇 성향별 기준가 (시작 크레딧에 맞춤) */
export const personaValue = (persona, name, startPoints) =>
  Math.round((RATINGS[name]?.personaValue?.[persona] ?? RATINGS[name]?.value1000 ?? 100) * startPoints / 1000);
