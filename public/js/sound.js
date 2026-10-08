// 효과음 재생 — 상태 변화(로그)와 타이머를 보고 알맞은 소리를 낸다.
import { SOUNDS, TICK_LAST_SECONDS } from './config.js';
import { remainingMs } from './common.js';

const LOG_SOUNDS = { bid: 'bid', sold: 'sold', unsold: 'unsold' };

export function createSoundPlayer({ enabled = true, volume = 1 } = {}) {
  const audio = {};
  for (const [name, cfg] of Object.entries(SOUNDS)) {
    const a = new Audio(cfg.file);
    a.preload = 'auto';
    audio[name] = a;
  }
  let on = enabled;
  let lastLogId = null;
  let lastSec = null;
  let lastLotKey = null;

  function play(name) {
    const base = audio[name];
    if (!on || !base) return;
    const a = base.cloneNode();           // 겹쳐서 재생 가능하도록 복제
    a.volume = Math.min(1, (SOUNDS[name].volume ?? 1) * volume);
    a.play().catch(() => { /* 브라우저 자동재생 차단 — 사용자가 한 번 클릭하면 이후 재생됨 */ });
  }

  return {
    get enabled() { return on; },
    set enabled(v) { on = v; },
    play,

    /** 서버 상태가 올 때마다 호출: 새 로그 중 입찰/낙찰/유찰에 소리 */
    onState(state) {
      const log = state.log;
      if (lastLogId === null) { lastLogId = log.at(-1)?.id ?? ''; return; }   // 첫 접속 땐 재생 안 함
      const idx = log.findIndex(e => e.id === lastLogId);
      const fresh = idx >= 0 ? log.slice(idx + 1) : [];
      lastLogId = log.at(-1)?.id ?? lastLogId;
      // 같은 순간에 여러 개가 오면 가장 중요한 소리 하나만
      const types = new Set(fresh.map(e => LOG_SOUNDS[e.type]).filter(Boolean));
      const pick = ['sold', 'unsold', 'bid'].find(t => types.has(t));
      if (pick) play(pick);
    },

    /** 매 프레임 호출: 남은 초가 줄어들 때마다 틱 */
    onFrame(state) {
      const c = state?.current;
      if (!c || c.status !== 'bidding' || state.paused) { lastSec = null; return; }
      const sec = Math.ceil(remainingMs(state) / 1000);
      const key = `${c.streamerId}:${c.bidCount}`;
      // 새 경매/새 입찰로 타이머가 리셋되면 기준만 갱신
      if (key !== lastLotKey) { lastLotKey = key; lastSec = sec; return; }
      if (lastSec !== null && sec < lastSec && sec > 0 && (!TICK_LAST_SECONDS || sec <= TICK_LAST_SECONDS)) play('tick');
      lastSec = sec;
    },
  };
}
