// 실제 명단 24명 + 봇 감독 8명으로 한 판 끝까지 (시세표 기록 확인용)
// BASE=http://localhost:8787 node test/bots-full.js [판수] [동시에 돌릴 방 수=1]
import { client, createRoom, BASE as URL } from './client.js';
const wait = ms => new Promise(r => setTimeout(r, ms));
const games = +process.argv[2] || 1;
const parallel = Math.max(1, +process.argv[3] || 1);

async function play(g) {
  const r = await createRoom({ title: `봇 모의 경매 ${g}`, timerSec: 5, startPoints: 1000 });
  const obs = await client(r.code); let st;
  obs.on('state', s => (st = s));
  await obs.call('join', { code: r.code, key: r.observerKey });
  await obs.call('prep:fillBots');
  await obs.call('prep:shuffle');
  const t0 = Date.now();
  await obs.call('auction:start');
  while (st?.phase !== 'result') await wait(500);
  const sec = Math.round((Date.now() - t0) / 1000);
  const sold = st.streamers.filter(s => s.status === 'sold');
  const left = st.directors.map(d => d.points);
  console.log(`[${g}] ${r.code} ${sec}초 · 낙찰 ${sold.length}/24 · 남은 크레딧 ${left.join('/')} · ` +
    st.streamers.map(s => `${s.name} ${s.price ?? '-'}`).join(', '));
  obs.close();
}

let next = 1;
await Promise.all(Array.from({ length: Math.min(parallel, games) }, async () => {
  while (next <= games) {
    const g = next++;
    await play(g).catch(e => console.error(`[${g}] 실패: ${e.message}`));
  }
}));
console.log(`${games}판 완료 (${URL})`);
process.exit();
