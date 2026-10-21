// 개인 평가 점수 검증: BASE=http://localhost:8787 node test/scores.js
// 옵저버만 점수를 보고, 결과 화면에서는 모두에게 보이며, 비워 두면 기존 경매와 같다
import { client, createRoom, BASE as URL } from './client.js';
const wait = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) { console.error('❌', m); process.exitCode = 1; } else console.log('✅', m); };
const until = async (fn, ms = 600000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout'); await wait(100); } };

const names = ['플라이', '베릴', '스나랑', '고수달', '마린', '감규리', '모카형', '위구리'];
const r = await createRoom({ test: true, title: '평가 점수 테스트', timerSec: 5, startPoints: 1000, streamers: names.map(name => ({ name })) });
const obs = await client(r.code); let os;
obs.on('state', s => (os = s));
await obs.call('join', { code: r.code, key: r.observerKey });
const view = await client(r.code); let vs;
view.on('state', s => (vs = s));
await view.call('join', { code: r.code });
await obs.call('prep:fillBots');
await until(() => os?.directors.length === 8 && vs?.directors.length === 8);
const sid = n => os.streamers.find(s => s.name === n).id;

assert(os.streamers.every(s => s.score === null), '처음에는 모든 평가 점수가 비어 있음');
assert((await view.call('prep:setScore', { id: sid('플라이'), score: 90 })).ok === false, '시청자는 평가 점수 입력 불가');
assert((await obs.call('prep:setScore', { id: sid('플라이'), score: 'abc' })).ok === false, '숫자가 아니면 거부');
assert((await obs.call('prep:setScore', { id: sid('플라이'), score: 92.25 })).ok, '옵저버 평가 점수 입력');
await until(() => os.streamers.find(s => s.name === '플라이').score === 92.3);
assert(true, '소수 첫째 자리로 반올림 (92.25 → 92.3)');
assert(vs.streamers.every(s => !('score' in s)), '경매 전: 시청자에게는 평가 점수가 보이지 않음');
const load = await obs.call('prep:setScores', { scores: { 베릴: 80, 스나랑: 30, 없는사람: 50, 마린: '' } });
assert(load.ok, '지난 평가 점수 불러오기');
await until(() => os.streamers.find(s => s.name === '베릴').score === 80);
assert(os.streamers.find(s => s.name === '스나랑').score === 30 && os.streamers.find(s => s.name === '마린').score === null, '이름으로 맞춰 채움 (빈 값은 비움)');
assert((await obs.call('prep:setScores', { scores: { 없는사람: 1 } })).ok === false, '겹치는 이름이 없으면 알림');
assert((await obs.call('prep:setScore', { id: sid('스나랑'), score: '' })).ok, '칸을 비우면 점수 지움');
await until(() => os.streamers.find(s => s.name === '스나랑').score === null);

await obs.call('auction:start');
await until(() => os.phase === 'auction');
assert(vs.streamers.every(s => !('score' in s)) && os.streamers.find(s => s.name === '플라이').score === 92.3, '경매 중: 옵저버만 평가 점수 확인');
await until(() => vs?.phase === 'result');
const f = vs.streamers.find(s => s.name === '플라이'), b = vs.streamers.find(s => s.name === '베릴');
assert(f.score === 92.3 && b.score === 80, '결과 화면: 모두에게 평가 점수 공개');
const sums = vs.directors.map(d => d.roster.reduce((a, id) => a + (vs.streamers.find(s => s.id === id).score ?? 0), 0));
assert(Math.abs(sums.reduce((a, b) => a + b, 0) - 172.3) < 1e-9, `팀 합계 총합 = 입력한 점수 합 (${sums.map(x => Math.round(x * 10) / 10).join(' / ')})`);
console.log(`룸 ${r.code} (${URL}/r/${r.code}?key=${r.observerKey})`);
process.exit();
