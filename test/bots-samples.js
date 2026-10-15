// 봇 감독 8명 경매 샘플을 판별로 보여준다 (서버 없이 가상 시계)
// node test/bots-samples.js [판수=20] [시작 크레딧=1000]
import { createRoom, handleAction, tick, nextDeadline } from '../src/logic.js';
import { STREAMER_NAMES } from '../src/roster.js';
import { RATINGS } from '../src/ratings.js';

const games = +process.argv[2] || 20;
const startPoints = +process.argv[3] || 1000;
const WATCH = ['플라이', '베릴', '피닉스박', '갱맘', '이로클라우드'];   // 판별로 따로 보여줄 인원
const obs = { role: 'observer' };
const agg = Object.fromEntries(STREAMER_NAMES.map(n => [n, { sum: 0, sold: 0, rankSum: 0 }]));
let watchInTop5 = 0;

for (let g = 1; g <= games; g++) {
  let now = 1e12;
  const { room } = createRoom({ title: 'sample', timerSec: 10, startPoints, streamers: STREAMER_NAMES.map(name => ({ name })) }, 'SMP', now);
  handleAction(room, now, obs, 'prep:fillBots');
  handleAction(room, now, obs, 'prep:shuffle');
  handleAction(room, now, obs, 'auction:start');
  while (room.phase !== 'result') { now = nextDeadline(room); tick(room, now); }

  const sold = room.streamers.filter(s => s.status === 'sold').sort((a, b) => b.price - a.price);
  sold.forEach((s, i) => { const a = agg[s.name]; a.sum += s.price; a.sold++; a.rankSum += i + 1; });
  const top5 = sold.slice(0, 5);
  watchInTop5 += top5.filter(s => WATCH.includes(s.name)).length;
  const order = room.order.map(id => room.streamers.find(s => s.id === id).name);
  const watch = WATCH.map(n => {
    const s = room.streamers.find(x => x.name === n);
    return `${n} ${s.status === 'sold' ? s.price : '미배정'}(${order.indexOf(n) + 1}번째)`;
  });
  const unsold = room.log.find(l => l.text.includes('유찰 경매 시작'))?.text.match(/\((\d+)명\)/)?.[1] ?? 0;
  console.log(`#${String(g).padStart(2)} 최고가 TOP5: ${top5.map(s => `${s.name} ${s.price}`).join(' · ')}`);
  console.log(`    5인: ${watch.join(' · ')} | 유찰 ${unsold}명`);
}

console.log(`\n=== ${games}판 평균 (시작 ${startPoints}) — 5인이 판별 최고가 TOP5 에 든 비율 ${(watchInTop5 / games / 5 * 100).toFixed(0)}% ===`);
console.log('스트리머        평균 낙찰가  평균 가격 순위  기록 전력 순위');
Object.entries(agg).filter(([, a]) => a.sold)
  .sort((x, y) => y[1].sum / y[1].sold - x[1].sum / x[1].sold)
  .forEach(([n, a]) => console.log(`${(WATCH.includes(n) ? '★ ' : '  ') + n.padEnd(10)} ${String(Math.round(a.sum / a.sold)).padStart(8)}  ${(a.rankSum / a.sold).toFixed(1).padStart(12)}  ${String(RATINGS[n].tier).padStart(12)}`));
