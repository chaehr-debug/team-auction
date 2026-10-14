// 실제 명단 24명 + 봇 감독 8명으로 한 판 끝까지 (시세표 기록 확인용)
// BASE=http://localhost:8787 node test/bots-full.js [판수] [동시에 돌릴 방 수=1]
import { client, createRoom, BASE as URL } from './client.js';
import { RATINGS } from '../src/ratings.js';
const wait = ms => new Promise(r => setTimeout(r, ms));
const games = +process.argv[2] || 1;
const parallel = Math.max(1, +process.argv[3] || 1);
// 성향별 집계: 팀 전력 합 순위(1 = 가장 강한 팀) · 남은 크레딧 · 팀 평균 기록
const per = {};
function tally(st) {
  const teams = st.directors.map(d => {
    const rs = d.roster.map(id => RATINGS[st.streamers.find(x => x.id === id).name]);
    const avg = k => rs.reduce((a, r) => a + (r[k] ?? r.rp), 0) / (rs.length || 1);
    return { d, power: rs.reduce((a, r) => a + r.power, 0), rp: avg('rp'), cur: avg('curRp'), tk: avg('tk'), placePts: avg('placePts') };
  }).sort((a, b) => b.power - a.power);
  teams.forEach((t, i) => {
    const p = per[t.d.personaLabel ?? '-'] ||= { n: 0, place: 0, first: 0, left: 0, rp: 0, cur: 0, tk: 0, placePts: 0 };
    p.n++; p.place += i + 1; p.first += i === 0; p.left += t.d.points;
    for (const k of ['rp', 'cur', 'tk', 'placePts']) p[k] += t[k];
  });
}

async function play(g) {
  const r = await createRoom({ title: `봇 모의 경매 ${g}`, timerSec: 5, startPoints: 1000 });
  let st, obs, lastAt = Date.now();
  // 연결이 끊기면 다시 붙어서 옵저버로 재입장 (끊긴 채로 끝을 못 보고 멈추는 것 방지)
  const connect = async () => {
    obs = await client(r.code);
    obs.on('state', s => { st = s; lastAt = Date.now(); });
    await obs.call('join', { code: r.code, key: r.observerKey });
  };
  await connect();
  await obs.call('prep:fillBots');
  await obs.call('prep:shuffle');
  const t0 = Date.now();
  await obs.call('auction:start');
  while (st?.phase !== 'result') {
    await wait(500);
    const silent = Date.now() - lastAt > 60000;   // 봇이 1~3초마다 움직이므로 1분 동안 소식이 없으면 끊긴 것
    if (obs.closed || silent) { console.log(`[${g}] 연결 끊김 → 재접속`); obs.close(); lastAt = Date.now(); await connect(); }
  }
  const sec = Math.round((Date.now() - t0) / 1000);
  const sold = st.streamers.filter(s => s.status === 'sold');
  const left = st.directors.map(d => `${d.personaLabel ?? d.name} ${d.points}`);
  console.log(`[${g}] ${r.code} ${sec}초 · 낙찰 ${sold.length}/24 · 남은 크레딧 ${left.join('/')} · ` +
    st.streamers.map(s => `${s.name} ${s.price ?? '-'}`).join(', '));
  tally(st);
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
console.log('성향 · 팀 수 · 평균 팀 전력 순위 · 1위 횟수 · 남은 크레딧 · 팀 평균(최고 RP / 이번 시즌 RP / TK / 순위 점수)');
for (const [k, p] of Object.entries(per)) console.log(`${k} · ${p.n} · ${(p.place / p.n).toFixed(2)} · ${p.first} · ${(p.left / p.n).toFixed(0)} · ` +
  `${(p.rp / p.n).toFixed(0)} / ${(p.cur / p.n).toFixed(0)} / ${(p.tk / p.n).toFixed(2)} / ${(p.placePts / p.n).toFixed(2)}`);
process.exit();
