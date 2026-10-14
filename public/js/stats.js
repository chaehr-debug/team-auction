// 모의 경매 시세표: dak.gg 평가(서버 src/ratings.js) + 끝난 모의 경매 낙찰가 집계
import { avatar, esc, fmt, cr, mostPicks } from './common.js';

const $ = id => document.getElementById(id);
let data, mode = 'all', sortKey = 'tier', sortDir = 1;

const COLS = [
  { key: 'tier', label: '순위', get: r => r.tier, fmt: r => `<span class="num">${r.tier}</span>` },
  { key: 'name', label: '스트리머', get: r => r.name, fmt: r => `<div class="who">${avatar(r, { size: 32 })}<div>
      <a href="https://dak.gg/er/players/${encodeURIComponent(r.nick ?? '')}" target="_blank" rel="noopener">${esc(r.name)}</a>
      <div class="nick">${esc(r.nick ?? '')}</div></div></div>` },
  { key: 'power', label: '전력 점수', get: r => r.power, fmt: r => `<b class="num">${fmt(r.power)}</b>` },
  { key: 'rp', label: '최고 RP', get: r => r.rp, fmt: r => `<span class="num">${fmt(r.rp)}</span>${r.bestSeason ? ` <span class="dim num" style="font-size:12px">시즌 ${r.bestSeason}</span>` : ''}${r.curRp != null && r.curRp !== r.rp ? `<div class="dim num" style="font-size:12px">이번 시즌 ${fmt(r.curRp)}</div>` : ''}` },
  { key: 'most', label: '최고 시즌 모스트', get: r => r.most?.[0]?.name ?? '', fmt: r => mostPicks(r.most, { size: 20 }) || '<span class="dim">–</span>' },
  { key: 'tk', label: '평균 TK', get: r => r.tk, fmt: r => `<span class="num">${r.tk.toFixed(2)}</span>` },
  { key: 'rank', label: '평균 순위', get: r => -r.rank, fmt: r => `<span class="num">${r.rank.toFixed(2)}</span> <span class="dim num">(${r.placePts}점)</span>` },
  { key: 'perf', label: '라운드 기대점수', get: r => r.perf, fmt: r => `<span class="num">${r.perf.toFixed(2)}</span>` },
  { key: 'play', label: '이번 시즌 판수', get: r => r.play, fmt: r => `<span class="num ${r.play < 100 ? 'dim' : ''}">${fmt(r.play)}</span>` },
  { key: 'value', label: '평가 기준가', get: r => r.value1000, fmt: r => cr(r.value1000) },
  { key: 'avg', label: '모의 평균 낙찰가', get: r => r.m?.avg ?? -1, fmt: r => r.m?.avg != null ? `<span class="bar" style="width:${Math.round(60 * r.m.avg / maxAvg())}px"></span><b>${cr(r.m.avg)}</b>` : '<span class="dim">–</span>' },
  { key: 'deal', label: '가성비', get: r => r.deal?.score ?? -Infinity, fmt: r => dealCell(r.deal) },
  { key: 'range', label: '최저 ~ 최고', get: r => r.m?.max ?? -1, fmt: r => r.m?.avg != null ? `<span class="num">${fmt(r.m.min)} ~ ${fmt(r.m.max)}</span>` : '<span class="dim">–</span>' },
  { key: 'sold', label: '낙찰 / 경매', get: r => (r.m?.sold ?? 0) / (r.m?.games || 1), fmt: r => r.m ? `<span class="num">${r.m.sold} / ${r.m.games}</span>` : '<span class="dim">0</span>' },
];

// 가성비: 평가 기준가를 실제 시장 지출 규모에 맞춘 '기대 낙찰가' 대비 실제 평균 낙찰가 (score > 1 이면 평가보다 싸게 팔림)
const DEAL_BAND = 0.15;   // ±15% 안쪽은 적정
function rows() {
  const list = data.streamers.map(s => ({ ...s, ...data.ratings[s.name], m: data.market[mode][s.name] || null }));
  const priced = list.filter(r => r.m?.avg > 0);
  const scale = priced.reduce((a, r) => a + r.m.avg, 0) / (priced.reduce((a, r) => a + r.value1000, 0) || 1);
  for (const r of priced) {
    const expect = r.value1000 * scale;
    r.deal = { expect: Math.round(expect), score: expect / r.m.avg, diff: r.m.avg / expect - 1 };
  }
  return list;
}
function dealCell(d) {
  if (!d) return '<span class="dim">–</span>';
  const pct = Math.round(Math.abs(d.diff) * 100);
  const [cls, word] = d.diff <= -DEAL_BAND ? ['deal-good', '저렴'] : d.diff >= DEAL_BAND ? ['deal-bad', '비쌈'] : ['dim', '적정'];
  return `<span class="${cls}" title="기대 낙찰가 ${fmt(d.expect)} CR">${word} <span class="num">${d.diff < 0 ? '−' : '+'}${pct}%</span></span>`;
}
const maxAvg = () => Math.max(1, ...Object.values(data.market[mode]).map(m => m.avg || 0));

function render() {
  const col = COLS.find(c => c.key === sortKey);
  const list = rows().sort((a, b) => {
    const x = col.get(a), y = col.get(b);
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sortDir;
  });
  $('table').innerHTML = `<thead><tr>${COLS.map(c => `<th data-key="${c.key}" class="${c.key === sortKey ? 'sorted' : ''}">${c.label}${c.key === sortKey ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
    <tbody>${list.map(r => `<tr>${COLS.map(c => `<td>${c.fmt(r)}</td>`).join('')}</tr>`).join('')}</tbody>`;
  const m = data.market;
  $('summary').innerHTML = `
    <div class="tile"><span class="muted">집계된 모의 경매</span><b>${fmt(m.rooms)}판</b></div>
    <div class="tile"><span class="muted">사람 감독이 참여한 판</span><b>${fmt(m.humanRooms)}판</b></div>
    <div class="tile"><span class="muted">마지막 집계</span><b style="font-size:16px">${m.lastAt ? new Date(m.lastAt).toLocaleString('ko-KR') : '아직 없음'}</b></div>
    <div class="tile"><span class="muted">dak.gg 기록 기준일</span><b style="font-size:16px">${esc(data.ratingsDate)}</b></div>`;
}

function renderFormula() {
  const f = data.formula;
  $('formula').innerHTML = `
    <div class="panel-title"><span>매물 평가 공식</span></div>
    <div>기록: dak.gg <b>랭크 스쿼드</b> — RP 는 시즌 1~12 중 최고 RP, 평균 TK · 평균 순위 · 판수는 가장 최근 시즌</div>
    <ol>
      <li><b>라운드 기대점수</b> = 평균 TK + 순위 점수. 순위 점수는 대회 배점(${data.placePoints.map((p, i) => `${i + 1}등 ${p}`).join(' · ')})으로 평균 순위를 환산 (예: 4.4위 → 3.6점)<br>
        판수가 적으면 운의 영향이 크므로 전체 평균 쪽으로 당겨서 반영 (반영 비율 = 판수 ÷ (판수 + ${f.shrinkGames}))</li>
      <li><b>기준 RP</b> = 시즌 1~12 중 가장 높았던 RP</li>
      <li><b>전력 점수</b> = 기준 RP + <code>${f.perfToRp} × (라운드 기대점수 − 전체 평균)</code><br>
        → RP 가 높을수록 위. RP 차이가 수백 점 안쪽이면 TK·순위가 순서를 가름 (기대점수 1점 = RP ${f.perfToRp}점)</li>
      <li><b>평가 기준가</b>: 전력이 높을수록 지수적으로 비싸짐 (평균 ≈ 시작 크레딧의 ${Math.round(f.avgPriceShare * 100)}%). </li>
      <li><b>가성비</b>: 평가 기준가를 모의 경매 전체 지출 규모에 맞춘 <b>기대 낙찰가</b>와 실제 평균 낙찰가를 비교합니다.<br>
        기대보다 ${Math.round(DEAL_BAND * 100)}% 이상 싸게 팔리면 <span class="deal-good">저렴</span>(평가 대비 저평가), ${Math.round(DEAL_BAND * 100)}% 이상 비싸게 팔리면 <span class="deal-bad">비쌈</span>(고평가), 그 사이는 적정. 칸에 마우스를 올리면 기대 낙찰가가 보입니다.</li>
      <li><b>봇 감독</b>: 남은 크레딧 총합을 남은 스트리머들의 평가 가치 비율로 나눈 시세에, 내 크레딧 여유·성향·운을 곱한 금액까지 입찰합니다.<br>
        뒤에 더 강한 스트리머가 충분히 남아 있으면 약한 매물은 건너뛰고(유찰) 유찰 경매에서 싸게 채웁니다. 크레딧이 남을수록 시세가 올라가 남은 크레딧을 끝까지 쓰고, 마지막 한 자리는 상위 매물에 몰아서 씁니다.<br>
        봇마다 <b>성향</b>이 있어 같은 스트리머도 다르게 평가합니다 (성향이 고루 섞이도록 배정):
        ${Object.values(data.personas || {}).map(p => `<b>${esc(p.label)}</b> ${esc(p.desc)}`).join(' · ')}</li>
    </ol>`;
}

$('table').addEventListener('click', e => {
  const th = e.target.closest('th[data-key]');
  if (!th) return;
  if (sortKey === th.dataset.key) sortDir *= -1;
  else { sortKey = th.dataset.key; sortDir = ['tier', 'name', 'most'].includes(sortKey) ? 1 : -1; }
  render();
});
$('mode').addEventListener('click', e => {
  const b = e.target.closest('button[data-mode]');
  if (!b) return;
  mode = b.dataset.mode;
  document.querySelectorAll('#mode button').forEach(x => x.classList.toggle('on', x === b));
  render();
});

fetch('/api/stats').then(r => r.json()).then(j => { data = j; render(); renderFormula(); })
  .catch(() => { $('table').innerHTML = '<tr><td class="dim">시세표를 불러오지 못했습니다.</td></tr>'; });
