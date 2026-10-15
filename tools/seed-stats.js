// 시세표 기록을 봇 8명 모의 경매 시뮬레이션 결과로 교체한다 (기존 기록은 서버에서 sales_archive 로 보관)
// ADMIN_KEY=... BASE=https://... node tools/seed-stats.js [판수=200] [시작 크레딧=1000]
import { createRoom, handleAction, tick, nextDeadline } from '../src/logic.js';
import { STREAMER_NAMES } from '../src/roster.js';

const BASE = process.env.BASE || 'http://localhost:8787';
const KEY = process.env.ADMIN_KEY;
const count = +process.argv[2] || 200;
const startPoints = +process.argv[3] || 1000;
if (!KEY) { console.error('ADMIN_KEY 환경 변수가 필요합니다.'); process.exit(1); }

const obs = { role: 'observer' };
const games = [];
for (let g = 0; g < count; g++) {
  let now = Date.now() - (count - g) * 60_000;
  const { room } = createRoom({ title: 'sim', timerSec: 10, startPoints, streamers: STREAMER_NAMES.map(name => ({ name })) }, 'SIM', now);
  handleAction(room, now, obs, 'prep:fillBots');
  handleAction(room, now, obs, 'prep:shuffle');
  handleAction(room, now, obs, 'auction:start');
  while (room.phase !== 'result') { now = nextDeadline(room); tick(room, now); }
  games.push({
    room: `SIM${String(g + 1).padStart(4, '0')}`, at: now, start: startPoints, humans: 0, bots: room.directors.length,
    rows: room.streamers.map(s => ({ name: s.name, price: s.status === 'sold' ? s.price : null, bot: s.status === 'sold' ? 1 : 0 })),
  });
}

const r = await fetch(`${BASE}/api/admin/stats`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-key': KEY }, body: JSON.stringify({ games }),
});
console.log(r.status, await r.text());
