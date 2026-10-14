// 모의 경매 시세표: dak.gg 평가(서버 src/ratings.js) + 끝난 모의 경매 낙찰가 집계
import { avatar, esc, fmt, cr } from './common.js';

const $ = id => document.getElementById(id);
let data, mode = 'all', sortKey = 'tier', sortDir = 1;

const COLS = [
  { key: 'tier', label: '순위', get: r => r.tier, fmt: r => `<span class="num">${r.tier}</span>` },
  { key: 'name', label: '스트리머', get: r => r.name, fmt: r => `<div class="who">${avatar(r, { size: 32 })}<div>
      <a href="https://dak.gg/er/players/${encodeURIComponent(r.nick ?? '')}" target="_blank" rel="noopener">${esc(r.name)}</a>
      <div class="nick">${esc(r.nick ?? '')}</div></div></div>` },
  { key: 'power', label: '전력 점수', get: r => r.power, fmt: r => `<b class="num">${fmt(r.power)}</b>` },
  { key: 'rp', label: '최고 RP', get: r => r.rp, fmt: r => `<span class="num">${fmt(r.rp)}</span>${r.bestSeason ? ` <span class="dim num" style="font-size:12px">시즌 ${r.bestSeason}</span>` : ''}${r.curRp != null && r.curRp !== r.rp ? `<div class="dim num" style="font-size:12px">이번 시즌 ${fmt(r.curRp)}</div>` : ''}` },
  { key: 'tk', label: '평균 TK', get: r => r.tk, fmt: r => `<span class="num">${r.tk.toFixed(2)}</span>` },
  { key: 'rank', label: '평균 순위', get: r => -r.rank, fmt: r => `<span class="num">${r.rank.toFixed(2)}</span> <span class="dim num">(${r.placePts}점)</span>` },
  { key: 'perf', label: '라운드 기대점수', get: r => r.perf, fmt: r => `<span class="num">${r.perf.toFixed(2)}</span>` },
  { key: 'play', label: '판수', get: r => r.play, fmt: r => `<span class="num ${r.play < 100 ? 'dim' : ''}">${fmt(r.play)}</span>` },
  { key: 'value', label: '평가 기준가', get: r => r.value1000, fmt: r => cr(r.value1000) },
  { key: 'avg', label: '모의 평균 낙찰가', get: r => r.m?.avg ?? -1, fmt: r => r.m?.avg != null ? `<span class="bar" style="width:${Math.round(60 * r.m.avg / maxAvg())}px"></span><b>${cr(r.m.avg)}</b>` : '<span class="dim">–</span>' },
  { key: 'range', label: '최저 ~ 최고', get: r => r.m?.max ?? -1, fmt: r => r.m?.avg != null ? `<span class="num">${fmt(r.m.min)} ~ ${fmt(r.m.max)}</span>` : '<span class="dim">–</span>' },
  { key: 'sold', label: '낙찰 / 경매', get: r => (r.m?.sold ?? 0) / (r.m?.games || 1), fmt: r => r.m ? `<span class="num">${r.m.sold} / ${r.m.games}</span>` : '<span class="dim">0</span>' },
];

const rows = () => data.streamers.map(s => ({ ...s, ...data.ratings[s.name], m: data.market[mode][s.name] || null }));
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
      <li><b>봇 감독</b>: 남은 크레딧 총합을 남은 스트리머들의 평가 가치 비율로 나눈 시세에, 내 크레딧 여유·성향·운을 곱한 금액까지 입찰합니다.<br>
        뒤에 더 강한 스트리머가 충분히 남아 있으면 약한 매물은 건너뛰고(유찰) 유찰 경매에서 싸게 채웁니다. 크레딧이 남을수록 시세가 올라가 남은 크레딧을 끝까지 쓰고, 마지막 한 자리는 상위 매물에 몰아서 씁니다.</li>
    </ol>`;
}

$('table').addEventListener('click', e => {
  const th = e.target.closest('th[data-key]');
  if (!th) return;
  if (sortKey === th.dataset.key) sortDir *= -1;
  else { sortKey = th.dataset.key; sortDir = ['tier', 'name'].includes(sortKey) ? 1 : -1; }
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
