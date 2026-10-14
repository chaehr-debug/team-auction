// 봇 감독 · 옵저버 정정 검증: BASE=http://localhost:8787 node test/bots.js (npm run dev 실행 중, .dev.vars 필요)
// 실제 명단 중 6명 + 사람 감독 1 + 봇 7 로 빠르게 끝까지 진행
import { client, BASE as URL } from './client.js';
const wait = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) { console.error('❌', m); process.exitCode = 1; } else console.log('✅', m); };

(async () => {
  const names = ['플라이', '베릴', '스나랑', '고수달', '마린', '감규리'];
  const res = await fetch(`${URL}/api/rooms`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ test: true, title: '봇 테스트', timerSec: 5, startPoints: 1000, streamers: names.map(name => ({ name })) }),
  }).then(r => r.json());
  const { code, observerKey } = res;
  const obs = await client(code); let state;
  obs.on('state', s => (state = s));
  await obs.call('join', { code, key: observerKey });
  const H = await client(code);
  await H.call('join', { code });
  await H.call('director:register', { name: '사람' });
  const until = async (fn, ms = 60000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout'); await wait(50); } };
  const sid = n => state.streamers.find(s => s.name === n).id;
  const dir = n => state.directors.find(d => d.name === n);
  const cur = () => state.current && state.streamers.find(s => s.id === state.current.streamerId)?.name;
  await until(() => state?.directors.length === 1);

  assert(state.streamers.find(s => s.name === '플라이').stats?.grade, '스트리머에 dak.gg 평가 첨부');
  assert((await H.call('prep:fillBots')).ok === false, '감독은 봇 추가 불가');
  assert((await obs.call('prep:fillBots')).ok, '옵저버 봇 채우기');
  assert(state.directors.length === 8 && state.directors.filter(d => d.bot).length === 7, '빈 자리 7개를 봇으로 채움');
  assert(!('botPlan' in state), '봇 입찰 계획은 클라이언트에 비공개');
  assert((await obs.call('prep:setOrder', { order: names.map(sid) })).ok, '순서 고정');
  assert((await obs.call('auction:start')).ok, '경매 시작');

  // 1) 봇이 알아서 입찰
  await until(() => state.current?.highBidderId && state.directors.find(d => d.id === state.current.highBidderId)?.bot, 15000);
  assert(true, `봇 자동 입찰 (${cur()} ${state.current.highBid} CR)`);
  // 2) 정정: 입찰 중 다시 경매
  assert((await H.call('lot:restart')).ok === false, '감독은 정정 불가');
  assert((await obs.call('lot:restart')).ok, '옵저버: 현재 경매 다시');
  assert(state.current.highBid === null && state.current.bidCount === 0 && cur() === '플라이', '입찰 기록 초기화 후 같은 스트리머로 재시작');
  // 사람이 플라이를 980(최대)에 입찰 → 봇보다 높음
  await until(() => state.current?.status === 'bidding');
  assert((await H.call('bid', { amount: 990 })).ok === false, '사람도 남은 자리 몫 보존 (990 거부)');
  assert((await H.call('bid', { amount: 980 })).ok, '사람 980 입찰');
  await until(() => state.current?.status === 'reveal');
  assert(state.current.result === 'sold' && dir('사람').points === 20, '플라이 → 사람 980 낙찰');
  // 3) 정정: 결과 표시 중 다시 경매 → 크레딧 환급
  assert((await obs.call('lot:restart')).ok, '결과 표시 중 다시 경매');
  assert(dir('사람').points === 1000 && dir('사람').roster.length === 0 && state.current.status === 'bidding', '낙찰 취소 · 980 환급');
  await H.call('bid', { amount: 500 });
  await until(() => state.current?.status === 'reveal' && state.current.result === 'sold');
  const flyBuyer = state.directors.find(d => d.id === state.current.highBidderId);
  const flyPrice = state.current.highBid;
  // 4) 정정: 지난 낙찰 취소 (다음 경매가 시작된 뒤)
  await until(() => cur() === '베릴');
  const before = flyBuyer.points;
  assert((await obs.call('sale:revoke', { id: sid('플라이') })).ok, '지난 낙찰 취소');
  const buyerNow = state.directors.find(d => d.id === flyBuyer.id);
  assert(buyerNow.points === before + flyPrice && !buyerNow.roster.includes(sid('플라이')), `${flyBuyer.name} ${flyPrice} 환급`);
  assert(state.passUnsold.includes(sid('플라이')), '취소한 스트리머는 유찰 경매 대기로');

  // 5) 끝까지 진행 — 봇이 남은 자리를 채움
  await until(() => state.phase === 'result', 240000);
  const sold = state.streamers.filter(s => s.status === 'sold');
  assert(sold.length === names.length, `모든 스트리머 배정 (${sold.map(s => `${s.name} ${s.price}`).join(', ')})`);
  assert(state.directors.every(d => d.points >= 0 && d.points >= (state.settings.teamSize - d.roster.length) * 10), '모든 감독이 남은 자리 몫을 지킴');
  // 6) 경매 종료 후 낙찰 취소 → 유찰 경매 재개
  const last = sold[0];
  assert((await obs.call('sale:revoke', { id: last.id })).ok, '경매 종료 후 낙찰 취소');
  assert(state.phase === 'rebid' && cur() === last.name, '유찰 경매 재개');
  await until(() => state.phase === 'result', 120000);
  assert(state.streamers.every(s => s.status === 'sold'), '다시 끝까지 배정');
  process.exit();
})().catch(e => { console.error(e); process.exit(1); });
