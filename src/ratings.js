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

function build() {
  const rows = STREAMER_NAMES.map(name => ({ name, ...(DATA[name] || {}), noData: !DATA[name] }));
  const withData = rows.filter(r => !r.noData);
  const median = arr => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  // 기록이 없는 인원은 중앙값으로 대신 평가
  for (const r of rows) if (r.noData) Object.assign(r, { rp: median(withData.map(x => x.rp)), tk: median(withData.map(x => x.tk)), rank: median(withData.map(x => x.rank)), play: 0, curRp: null, bestSeason: null });

  for (const r of rows) r.perfRaw = r.tk + placePoints(r.rank);
  const meanPerf = withData.reduce((s, r) => s + r.perfRaw, 0) / (withData.length || 1);
  for (const r of rows) {
    const k = r.play / (r.play + FORMULA.shrinkGames);
    r.perf = r.noData ? meanPerf : k * r.perfRaw + (1 - k) * meanPerf;
    r.power = Math.round(r.rp + FORMULA.perfToRp * (r.perf - meanPerf));
  }
  const sorted = [...rows].sort((a, b) => b.power - a.power);
  sorted.forEach((r, i) => { r.tier = i + 1; });
  const min = sorted.at(-1).power, max = sorted[0].power;
  for (const r of rows) r.weight = Math.exp(FORMULA.priceCurve * (r.power - min) / (max - min || 1));
  const meanW = rows.reduce((s, r) => s + r.weight, 0) / rows.length;
  // 시작 크레딧 1,000 기준 기준가 (10 단위)
  for (const r of rows) r.value1000 = Math.max(10, Math.round(1000 * FORMULA.avgPriceShare * r.weight / meanW / 10) * 10);

  return Object.fromEntries(rows.map(r => [r.name, {
    nick: r.nick ?? null, rp: r.rp, bestSeason: r.bestSeason ?? null, curRp: r.curRp ?? null,
    tk: r.tk, rank: r.rank, play: r.play, noData: r.noData,
    placePts: +placePoints(r.rank).toFixed(2), perf: +r.perf.toFixed(2),
    power: r.power, tier: r.tier, value1000: r.value1000,
  }]));
}

export const RATINGS = build();
export const RATINGS_DATE = FETCHED_AT;

/** 시작 크레딧에 맞춘 기준가 */
export const baseValue = (name, startPoints) => Math.round((RATINGS[name]?.value1000 ?? 100) * startPoints / 1000);
