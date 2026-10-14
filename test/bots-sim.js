// 봇 감독 8명 경매를 서버 없이 빠르게 여러 판 돌려 봇 AI 를 점검한다 (가상 시계)
// node test/bots-sim.js [판수=200] [시작 크레딧=1000]
import { createRoom, handleAction, tick, nextDeadline } from '../src/logic.js';
import { STREAMER_NAMES } from '../src/roster.js';
import { RATINGS, PERSONAS } from '../src/ratings.js';

const games = +process.argv[2] || 200;
const startPoints = +process.argv[3] || 1000;
const obs = { role: 'observer' };
const tot = { mainUnsold: 0, rebidLots: 0, left: 0, leftMax: 0, unassigned: 0, corr: 0, topSpend: 0 };
const leftDist = [];
// 성향별: 팀 전력 합 순위(1 = 가장 강한 팀) · 남은 크레딧 · 성향 기록 평균
const per = Object.fromEntries(Object.keys(PERSONAS).map(k => [k, { n: 0, place: 0, power: 0, left: 0, rp: 0, tk: 0, placePts: 0, cur: 0 }]));

for (let g = 0; g < games; g++) {
  let now = 1e12;
  const { room } = createRoom({ title: 'sim', timerSec: 10, startPoints, streamers: STREAMER_NAMES.map(name => ({ name })) }, 'SIM', now);
  handleAction(room, now, obs, 'prep:fillBots');
  handleAction(room, now, obs, 'prep:shuffle');
  handleAction(room, now, obs, 'auction:start');
  while (room.phase !== 'result') {
    now = nextDeadline(room);
    tick(room, now);
  }
  tot.mainUnsold += +(room.log.find(l => l.text.includes('유찰 경매 시작'))?.text.match(/\((\d+)명\)/)?.[1] ?? 0);
  tot.rebidLots += room.log.filter(l => l.type === 'lot' && l.text.includes('[유찰 경매]')).length;
  for (const d of room.directors) { tot.left += d.points; tot.leftMax = Math.max(tot.leftMax, d.points); leftDist.push(d.points); }
  tot.unassigned += room.streamers.filter(s => s.status !== 'sold').length;
  // 전력 상위 6명에게 쓴 크레딧 비율
  const sold = room.streamers.filter(s => s.status === 'sold');
  const spent = sold.reduce((a, s) => a + s.price, 0);
  const top = sold.filter(s => RATINGS[s.name].tier <= 6).reduce((a, s) => a + s.price, 0);
  tot.topSpend += spent ? top / spent : 0;
  const teams = room.directors.map(d => {
    const rs = d.roster.map(id => RATINGS[room.streamers.find(x => x.id === id).name]);
    const avg = k => rs.reduce((a, r) => a + (r[k] ?? r.rp), 0) / (rs.length || 1);
    return { d, power: rs.reduce((a, r) => a + r.power, 0), rp: avg('rp'), tk: avg('tk'), placePts: avg('placePts'), cur: avg('curRp') };
  }).sort((a, b) => b.power - a.power);
  teams.forEach((t, i) => {
    const p = per[t.d.persona]; if (!p) return;
    p.n++; p.place += i + 1; p.power += t.power; p.left += t.d.points;
    for (const k of ['rp', 'tk', 'placePts', 'cur']) p[k] += t[k];
  });
}
leftDist.sort((a, b) => a - b);
const pg = n => (n / games).toFixed(1);
console.log(`${games}판 · 시작 ${startPoints}`);
console.log(`본 경매 유찰 평균 ${pg(tot.mainUnsold)}명 · 유찰 경매 진행 ${pg(tot.rebidLots)}회 · 미배정 ${pg(tot.unassigned)}명`);
console.log(`감독 1인 평균 남은 크레딧 ${(tot.left / games / 8).toFixed(0)} · 중앙값 ${leftDist[leftDist.length >> 1]} · 상위 10% ${leftDist[Math.floor(leftDist.length * 0.9)]} · 최대 ${tot.leftMax}`);
console.log(`상위 6명에 쓴 비율 ${(tot.topSpend / games * 100).toFixed(0)}%`);
console.log('\n성향       팀 수  팀 전력 순위  남은 크레딧  팀 평균: 최고 RP · 이번 시즌 RP · TK · 순위 점수');
for (const [k, p] of Object.entries(per)) if (p.n)
  console.log(`${PERSONAS[k].label.padEnd(8)} ${String(p.n).padStart(5)}  ${(p.place / p.n).toFixed(2).padStart(10)}  ${(p.left / p.n).toFixed(0).padStart(10)}  ` +
    `${(p.rp / p.n).toFixed(0)} · ${(p.cur / p.n).toFixed(0)} · ${(p.tk / p.n).toFixed(2)} · ${(p.placePts / p.n).toFixed(2)}`);
