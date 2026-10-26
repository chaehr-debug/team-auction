// 데모 룸: 감독 8명 + 스트리머 24명, 낙찰 2 · 유찰 1 진행 후 입찰 중 일시 정지 (화면 확인용)
// BASE=http://localhost:8787 node test/demo.js [prep]
import { client, createRoom, BASE as URL } from './client.js';
const wait = ms => new Promise(r => setTimeout(r, ms));
const r = await createRoom({ title: '이리도 시즌 1 팀 경매', timerSec: 5, startPoints: 1000 });   // 스트리머는 고정 명단 (src/roster.js)
console.log(`OBS=${URL}/r/${r.code}?key=${r.observerKey}`); console.log(`CODE=${r.code}`);
const obs = await client(r.code); let st; obs.on('state', s => (st = s));
await obs.call('join', { code: r.code, key: r.observerKey });
const dirs = [];
for (const n of ['팀장A','팀장B','팀장C','팀장D','팀장E','팀장F','팀장G','팀장H']) {
  const s = await client(r.code); await s.call('join', {}); const reg = await s.call('director:register', { name: n });
  if (!dirs.length) console.log('TOKEN=' + reg.token); dirs.push(s);
  if (n === '팀장D') await s.call('director:update', { cam: 'https://vdo.ninja/?view=vEsG2vS' });   // 캠 표시 확인용
}
if (process.argv[2] === 'prep') { await obs.call('prep:setMinBid', { id: st.order[0], minBid: 100 }); console.log('READY'); }
else {
  await obs.call('auction:start');
  const nextLot = async () => { while (st.current?.status === 'bidding') await wait(100); while (st.current?.status !== 'bidding') await wait(100); };
  for (let k = 0; k < 2; k++) {
    await dirs[k].call('bid', { amount: 100 + k * 50 }); await dirs[k + 2].call('bid', { amount: 200 + k * 50 }); await dirs[k + 4].call('bid', { amount: 260 + k * 30 });
    await nextLot();
  }
  await nextLot();   // 3번째는 아무도 입찰 안 함 → 유찰
  await dirs[1].call('bid', { amount: 120 }); await dirs[6].call('bid', { amount: 180 }); await dirs[3].call('bid', { amount: 310 });
  await obs.call('auction:pause');
  console.log('READY');
}
