// dak.gg 에서 스트리머 기록(랭크 스쿼드, RP 는 시즌 1~12 최고값)을 가져와 src/ratings-data.js 를 만든다.
// 직접 실행: node tools/fetch-ratings.js  → 확인 후 npm run deploy
// 값: rp = 시즌 1~12 중 최고 RP, bestSeason = 그 시즌, curRp = 이번 시즌 RP,
//     tk = 평균 TK(팀킬), rank = 평균 순위, play = 판수 (tk·rank·play 는 가장 최근 랭크 기록 시즌)
// dak.gg 에서 못 찾은 스트리머는 기존 값을 유지한다 (src/ratings-data.js 를 직접 고쳐 수동 입력 가능)
import { writeFileSync, existsSync } from 'node:fs';
import { ROSTER } from '../src/roster.js';

const API = nick => `https://er.dakgg.io/api/v1/players/${encodeURIComponent(nick)}/profile`;
const RANKED = { matchingModeId: 3, teamModeId: 3 };   // 랭크 · 스쿼드
// dak.gg seasonId: 19 = 시즌 1, 21 = 시즌 2 … 41 = 시즌 12 (짝수는 프리 시즌, 17 이하는 얼리 액세스)
const SEASONS = { from: 19, to: 41 };
const seasonNo = id => (id - 17) / 2;
const wait = ms => new Promise(r => setTimeout(r, ms));

const file = new URL('../src/ratings-data.js', import.meta.url);
const prev = existsSync(file) ? (await import(file)).default : {};
const out = {};
for (const { name, nick } of ROSTER) {
  try {
    const r = await fetch(API(nick), { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://dak.gg/' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    // 가장 최근 시즌 중 랭크 기록이 있는 시즌
    const ranked = d.playerSeasonOverviews
      .filter(o => o.matchingModeId === RANKED.matchingModeId && o.teamModeId === RANKED.teamModeId && o.play > 0)
      .sort((a, b) => b.seasonId - a.seasonId)[0];
    if (!ranked) throw new Error('랭크 기록 없음');
    const season = d.playerSeasons.find(s => s.seasonId === ranked.seasonId);
    const best = d.playerSeasons
      .filter(s => s.seasonId >= SEASONS.from && s.seasonId <= SEASONS.to && s.seasonId % 2 === 1 && s.mmr)
      .sort((a, b) => b.mmr - a.mmr)[0];
    const curRp = season?.mmr ?? ranked.mmr;
    out[name] = {
      nick,
      season: ranked.seasonId,
      rp: best?.mmr ?? curRp,
      bestSeason: best ? seasonNo(best.seasonId) : seasonNo(ranked.seasonId),
      curRp,
      tk: +(ranked.teamKill / ranked.play).toFixed(2),
      rank: +(ranked.place / ranked.play).toFixed(2),
      play: ranked.play,
    };
    console.log(name.padEnd(8), nick.padEnd(10), JSON.stringify(out[name]));
  } catch (e) {
    console.error(`✕ ${name} (${nick}): ${e.message}${prev[name] ? ' — 기존 값 유지' : ''}`);
    if (prev[name]) out[name] = prev[name];
  }
  await wait(400);
}

writeFileSync(file,
  `// dak.gg 기록 스냅샷 (tools/fetch-ratings.js 로 갱신, ${new Date().toISOString().slice(0, 10)})\n` +
  `// rp: 시즌 1~12 최고 RP (bestSeason: 그 시즌) · curRp: 이번 시즌 RP · tk: 평균 TK · rank: 평균 순위 · play: 판수 (최근 랭크 스쿼드)\n` +
  `export const FETCHED_AT = '${new Date().toISOString().slice(0, 10)}';\n` +
  `export default ${JSON.stringify(out, null, 2)};\n`);
console.log(`\n${Object.keys(out).length}/${ROSTER.length}명 저장 → src/ratings-data.js`);
