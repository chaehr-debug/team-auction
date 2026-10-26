// 대회용 순서: 옵저버 + 비밀번호로만 적용, 틀리면 순서 그대로
// BASE=http://localhost:8787 node test/tournament.js
import { client, createRoom } from './client.js';
const assert = (c, m) => { if (!c) { console.error('✗', m); process.exit(1); } console.log('✓', m); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const EXPECT = ['마린', '후참', '자연', '감규리', '왈도쿤', '앰비션', '플라이', '위구리', '고수달', '이로나묭 치카', '갱맘', '네브짱',
  '베릴', '스나랑', '피닉스박', '방찌', '이로클라우드', '눈가루', '큐베', '쾅준', '모카형', '플레임', '노페', '유세라'];

const r = await createRoom({ timerSec: 5, startPoints: 1000 });
const obs = await client(r.code); let st; obs.on('state', s => (st = s));
await obs.call('join', { code: r.code, key: r.observerKey });
const dir = await client(r.code); await dir.call('join', {}); await dir.call('director:register', { name: '팀장A' });
const names = () => st.order.map(id => st.streamers.find(s => s.id === id).name);
await wait(300);
const before = names().join();

assert((await dir.call('prep:tournamentOrder', { password: '2784616' })).ok === false, '감독은 대회용 순서 불가');
const bad = await obs.call('prep:tournamentOrder', { password: '0000' });
assert(bad.ok === false && /비밀번호/.test(bad.error), '틀린 비밀번호 거부');
await wait(300);
assert(names().join() === before, '틀리면 순서 그대로');
assert((await obs.call('prep:tournamentOrder', { password: '2784616' })).ok, '맞는 비밀번호 적용');
await wait(300);
assert(names().join() === EXPECT.join(), '대회용 순서로 정렬');
assert(!JSON.stringify(st).includes('2784616'), '상태에 비밀번호 노출 안 됨');
process.exit(0);
