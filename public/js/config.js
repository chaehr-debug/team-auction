// ============================================================
// 화면 설정 — 용어와 효과음은 여기서 바꿉니다.
// (서버 쪽 로그/오류 문구의 용어는 src/logic.js 의 CURRENCY 를 같이 바꾸세요)
// ============================================================

/** 화폐 용어 */
export const CURRENCY = {
  name: '크레딧',   // 문장에 쓰이는 이름 (예: "보유 크레딧")
  unit: 'CR',       // 숫자 뒤 단위 (예: "1,000 CR")
};

/**
 * 효과음 — public/sounds/ 폴더의 파일을 같은 이름으로 바꾸면 됩니다.
 * mp3 등 다른 형식을 쓰려면 file 경로의 확장자만 바꾸세요.
 * volume: 0 ~ 1
 */
export const SOUNDS = {
  bid:    { file: '/sounds/bid.wav',    volume: 0.7 },  // 입찰
  sold:   { file: '/sounds/sold.wav',   volume: 0.9 },  // 낙찰
  unsold: { file: '/sounds/unsold.wav', volume: 0.8 },  // 유찰
  tick:   { file: '/sounds/tick.wav',   volume: 0.5 },  // 타이머 1초마다
};

/** 타이머 틱 소리를 남은 몇 초부터 낼지 (0 = 처음부터 매초) */
export const TICK_LAST_SECONDS = 0;

/**
 * 패널 배경 이미지 — public/backgrounds/ 폴더에 아래 이름으로 이미지를 넣으면 자동 적용됩니다.
 * 확장자는 webp / png / jpg / jpeg / gif 중 아무거나 (예: queue.png). 파일이 없으면 기본 배경.
 * panels: 이 이미지를 쓸 패널 이름 (views.js 의 패널 이름)
 */
export const BACKGROUNDS = {
  queue:     { file: 'queue',     panels: ['queue', 'upcoming'] },  // 3단계 경매 순서 (오버레이 '다음 경매 순서' 포함)
  lot:       { file: 'lot',       panels: ['lot'] },                // 3단계 가운데 현재 경매 중인 스트리머 창
  log:       { file: 'log',       panels: ['log'] },                // 3단계 경매 로그
  directors: { file: 'directors', panels: ['directors'] },          // 3단계 감독 표기 창
  teams:     { file: 'teams',     panels: ['teams'] },              // 5단계 최종 팀 구성
};
export const BACKGROUND_EXTS = ['webp', 'png', 'jpg', 'jpeg', 'gif'];

/** 감독 캠 (vdo.ninja) */
export const CAM = {
  // 감독이 '내 캠 연결하기'를 누르면 열리는 송출 페이지 (ID 는 자동 생성)
  // &quality=1: 최대 720p 로 송출 (실제 화질은 아래 bitrate 로 옵저버 화면에서 조절)
  pushUrl: id => `https://vdo.ninja/?push=${id}&webcam&quality=1`,
  // 등록되는 시청 링크
  viewUrl: id => `https://vdo.ninja/?view=${id}`,
  // vdo.ninja 시청 링크에 자동으로 붙일 옵션: 화면 UI 숨김 + 감독 마이크 소리 끔
  // (감독 목소리를 방송에 넣고 싶으면 '&noaudio' 를 지우세요)
  viewParams: '&cleanoutput&noaudio',
  // 받는 화질 (kbps) — 캠은 옵저버 화면 · OBS 오버레이에서만 받는다 (감독·시청자 화면은 캠을 받지 않음)
  //   active: 지금 최고 입찰자 캠 (화면에 보이는 캠) → 선명하게
  //   idle:   화면에 안 보이고 대기 중인 캠 → 거의 0 으로 낮춰 감독 업로드(인터넷) 부담을 없앰 (연결은 유지해서 즉시 전환)
  bitrate: { active: 2000, idle: 30 },
  // true: 8명 캠을 미리 모두 불러와 입찰 시 즉시 전환 / false: 입찰한 감독 캠만 그때 불러옴(전환 1~3초)
  preload: true,
};
