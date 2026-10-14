// 봇 감독 8명 경매를 서버 없이 빠르게 여러 판 돌려 봇 AI 를 점검한다 (가상 시계)
// node test/bots-sim.js [판수=200] [시작 크레딧=1000]
import { createRoom, handleAction, tick, nextDeadline } from '../src/logic.js';
import { STREAMER_NAMES } from '../src/roster.js';
import { RATINGS } from '../src/ratings.js';

const games = +process.argv[2] || 200;
const startPoints = +process.argv[3] || 1000;
const obs = { role: 'observer' };
const tot = { mainUnsold: 0, rebidLots: 0, left: 0, leftMax: 0, unassigned: 0, corr: 0, topSpend: 0 };
const leftDist = [];

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
}
leftDist.sort((a, b) => a - b);
const per = n => (n / games).toFixed(1);
console.log(`${games}판 · 시작 ${startPoints}`);
console.log(`본 경매 유찰 평균 ${per(tot.mainUnsold)}명 · 유찰 경매 진행 ${per(tot.rebidLots)}회 · 미배정 ${per(tot.unassigned)}명`);
console.log(`감독 1인 평균 남은 크레딧 ${(tot.left / games / 8).toFixed(0)} · 중앙값 ${leftDist[leftDist.length >> 1]} · 상위 10% ${leftDist[Math.floor(leftDist.length * 0.9)]} · 최대 ${tot.leftMax}`);
console.log(`상위 6명에 쓴 비율 ${(tot.topSpend / games * 100).toFixed(0)}%`);
