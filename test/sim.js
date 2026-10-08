// 경매 흐름 시뮬레이션: node test/sim.js (서버가 PORT 에서 실행 중이어야 함)
import { client, createRoom, BASE as URL } from './client.js';
const wait = ms => new Promise(r => setTimeout(r, ms));
const call = (s, ev, p) => s.call(ev, p);
const assert = (c, m) => { if (!c) { console.error('❌', m); process.exitCode = 1; } else console.log('✅', m); };

(async () => {
  const res = await fetch(`${URL}/api/rooms`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '테스트', timerSec: 5, startPoints: 500, streamers: [1, 2, 3, 4, 5, 6].map(i => ({ name: `S${i}` })) }),
  }).then(r => r.json());
  const { code, observerKey } = res;

  const obs = await client(code); let state;
  obs.on('state', s => (state = s));
  await call(obs, 'join', { code, key: observerKey });
  const A = await client(code), B = await client(code);
  await call(A, 'join', { code }); await call(B, 'join', { code });
  await call(A, 'director:register', { name: 'A' });
  await call(B, 'director:register', { name: 'B' });
  // 준비: 순서 고정 + 최소 입찰가
  const ids = Object.fromEntries(state.streamers.map(s => [s.name, s.id]));
  await call(obs, 'prep:setOrder', { order: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'].map(n => ids[n]) });
  await call(obs, 'prep:setMinBid', { id: ids.S1, minBid: 100 });
  assert((await call(A, 'prep:shuffle')).ok === false, '감독은 순서 변경 불가');
  assert((await call(obs, 'auction:start')).ok, '경매 시작');

  const until = async (fn, ms = 20000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout'); await wait(50); } };
  const cur = () => state.current && state.streamers.find(s => s.id === state.current.streamerId).name;
  const dir = n => state.directors.find(d => d.name === n);

  // S1
  assert(cur() === 'S1', 'S1 경매 진행');
  assert((await call(A, 'bid', { amount: 50 })).ok === false, '최소 입찰가 미만 거부');
  assert((await call(A, 'bid', { amount: 105 })).ok === false, '10P 단위 아님 거부');
  assert((await call(A, 'bid', { amount: 100 })).ok, 'A 100 입찰');
  assert((await call(A, 'bid', { amount: 200 })).ok === false, '최고 입찰자 재입찰 거부');
  assert((await call(B, 'bid', { amount: 100 })).ok === false, '동일 금액 거부');
  assert((await call(B, 'bid', { amount: 600 })).ok === false, '보유 포인트 초과 거부');
  assert((await call(obs, 'auction:pause')).ok, '일시 정지');
  const before = state.current.pausedRemainingMs;
  assert((await call(B, 'bid', { amount: 150 })).ok === false, '일시 정지 중 입찰 거부');
  await wait(1500);
  assert(state.current.pausedRemainingMs === before && state.current.status === 'bidding', '정지 중 타이머 멈춤');
  assert((await call(obs, 'auction:resume')).ok, '재진행');
  assert((await call(B, 'bid', { amount: 150 })).ok, 'B 150 상위 입찰');
  assert(Math.round((state.current.endsAt - state.serverNow) / 1000) === 10, '상위 입찰 시 타이머 10초 리셋');
  await until(() => state.current?.status === 'reveal');
  assert(dir('B').points === 350 && dir('A').points === 500, 'B 낙찰 150P 차감, A 환급');

  // S2 유찰
  await until(() => cur() === 'S2' && state.current.status === 'bidding');
  await until(() => state.current?.status === 'reveal');
  assert(state.current.result === 'unsold', 'S2 유찰');

  for (const n of ['S3', 'S4', 'S5']) {
    await until(() => cur() === n && state.current.status === 'bidding');
    await call(A, 'bid', { amount: 10 });
    await until(() => state.current?.status === 'reveal');
  }
  assert(dir('A').roster.length === 3, 'A 3명 영입 완료');
  await until(() => cur() === 'S6' && state.current.status === 'bidding');
  assert((await call(A, 'bid', { amount: 10 })).ok === false, '팀 완성 감독 입찰 거부');
  await until(() => state.phase === 'rebid', 30000);
  assert(JSON.stringify(state.unsoldQueue) === JSON.stringify([ids.S2, ids.S6]), '유찰 경매 순서 S2, S6');
  assert((await call(A, 'bid', { amount: 10 })).ok === false, '유찰 경매: 3명 완성 감독 참여 불가');
  assert((await call(B, 'bid', { amount: 10 })).ok, '유찰 경매: B 입찰');
  await until(() => state.phase === 'result', 60000);
  assert(dir('B').roster.length === 2 && dir('B').points === 340, 'B 최종 2명, 340P');
  assert(state.streamers.find(s => s.name === 'S6').status === 'unassigned', 'S6 미배정 처리');
  console.log(state.log.map(l => l.text).join('\n'));
  process.exit();
})().catch(e => { console.error(e); process.exit(1); });
