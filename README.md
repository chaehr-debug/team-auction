# 이리도 시즌 1 팀 경매

옵저버 1명 + 감독 최대 8명 + 고정 스트리머 24명으로 하는 실시간 팀 경매입니다.

## 주소 (Cloudflare 배포)

https://team-auction.coach-draft-game.workers.dev

## 개발 / 배포

```bash
npm install
npm run dev       # 로컬 실행 http://localhost:8787 (wrangler dev)
npm run deploy    # Cloudflare 에 배포 (wrangler login 필요)
```

구조: Cloudflare Workers + Durable Objects
- `src/logic.js` — 경매 규칙 (순수 로직)
- `src/worker.js` — 라우팅 · 룸 Durable Object (WebSocket, 알람으로 타이머 판정) · 이미지 저장 Durable Object
- `public/` — 화면 (정적 파일)

## 진행 흐름

| 단계 | 화면 | 내용 |
|---|---|---|
| 1. 룸 접속 | `/` | 옵저버: 룸 생성 (고정 스트리머 24명, 타이머 5~20초, 포인트 500~2000) · 감독: 룸 코드/링크로 입장 |
| 2. 준비 | `/r/코드` | 옵저버: 순서 지정(드래그/▲▼/무작위), 최소 입찰가 지정, 개인 평가 점수(선택) · 감독: 닉네임 등록, 순서/포인트 미리보기 |
| 3. 경매 | `/r/코드` | 10P 단위 입찰, 상위 입찰 시 타이머 10초 리셋, 일시 정지/재진행 |
| 4. 유찰 경매 | `/r/코드` | 유찰된 스트리머를 순서대로 재경매 (3명 완성 감독은 참여 불가) |
| 5. 결과 | `/r/코드` | 팀별 구성 및 낙찰가 |

### 링크 종류
- 감독 입장: `/r/코드`
- 옵저버(진행자 전용): `/r/코드?key=옵저버키` — **공개 금지**
- 로그 오버레이: `/overlay/코드?bg=transparent` — 채팅창 형태 경매 로그만 (OBS 브라우저 소스)
  - `bg=dark | transparent | green` · `sound=0` 효과음 끄기 · `volume=0.5`
  - 방송은 옵저버 화면으로 진행합니다 (감독·현재 경매·캠을 띄우던 방송 오버레이는 폐쇄)

## 레이아웃 수정 가이드

| 바꾸고 싶은 것 | 수정할 파일 |
|---|---|
| 색상(게임 공식 컬러), 폰트(Pretendard · Oxanium), 팀 색상, 모서리 | `public/css/theme.css` |
| 패널 위치/크기 (화면 배치) | `public/css/layout.css` — `grid-template-areas` |
| 어떤 화면에 어떤 패널을 보여줄지 | `public/js/views.js` |
| 패널 내부 모양 (HTML) | `public/js/panels.js` |
| 패널 내부 스타일 | `public/css/base.css` |

예) 감독 경매 화면에서 로그를 오른쪽으로 옮기려면 `layout.css`의 `.layout-auction-director` 에서 이름만 바꿔 배치하면 됩니다.

현재 경매 대상(`lot`) 패널은 패널 크기에 맞춰 글자·이미지가 같이 커지고 작아지므로, 배치를 바꿔도 다시 손볼 필요가 적습니다.

## 봇 감독 · 매물 평가 · 시세표
- 준비 단계 `🤖 빈 자리 봇으로 채우기`: 빈 감독 자리를 자동 입찰 봇으로 채움 (✕ 로 빼기 가능)
- 봇은 dak.gg 기록 기반 **평가 기준가** × 공격성 × 운 × 남은 크레딧 여유 만큼까지 1~3초 간격으로 입찰
- 봇 성향(`src/ratings.js` PERSONAS): 종합형 · RP 우선 · 승률 우선(평균 순위) · 킬 우선(평균 TK) · 현재 폼 우선(이번 시즌 RP) — 성향마다 기준가를 따로 계산해 서로 다른 스트리머를 노림
- 평가 공식: `src/ratings.js` (라운드 기대점수 = 평균 TK + 순위 점수, 전력 = 시즌 1~12 최고 RP + 150 × (기대점수 − 평균))
- 기록 갱신: `node tools/fetch-ratings.js` → `src/ratings-data.js` (dak.gg 랭크 스쿼드, 인게임 닉네임은 `src/roster.js`)
- 시세표 `/stats`: 평가표 + 끝난 모의 경매 낙찰가 집계 (시작 크레딧 1,000 기준 환산, 봇 포함/사람만 전환). 저장소는 StatsStore Durable Object

## 개인 평가 점수 (선택 기능)
- 준비 단계 경매 순서 목록의 `평가` 칸에 옵저버가 스트리머별 점수를 입력 (비워 두면 기존 경매와 완전히 같음)
- 점수는 옵저버에게만 보이고, 결과 화면에서 모두에게 팀별 **개인 평가 합계 · 순위**와 선수별 점수로 공개
- 입력한 점수는 옵저버 브라우저(localStorage `auction:scores`)에 이름별로 저장 → 다음 룸에서 `📥 지난 평가 점수 불러오기`로 이름을 맞춰 채움

## 옵저버 정정
- `↺ 현재 경매 다시` (헤더): 현재 스트리머를 처음부터 다시 — 결과 표시 중이면 낙찰/유찰 취소 후 재경매
- 감독 카드·최종 팀의 스트리머 `✕`: 낙찰 취소 → 크레딧 환급 후 유찰 경매에서 다시 (경매 종료 후면 유찰 경매 재개)

## 스트리머 명단 · 프로필 사진
- 명단은 고정 24명: `src/roster.js` (모든 룸이 이 명단으로 만들어지고, 기본 경매 순서도 이 순서)
- 사진: `public/streamers/` 에 `스트리머명.확장자` (예: `플라이.png`, `이로나묭 치카.png`)로 넣고 `npm run deploy` → 이후 새로 만드는 모든 룸에 적용
- 특정 룸에서만 바꾸려면 준비 단계 순서 목록의 `사진` 버튼
- 감독: 입장 시 또는 준비 단계 `내 팀` 패널에서 변경
- 사진이 없으면 이름 첫 글자로 만든 더미 아바타가 표시됩니다. 업로드한 사진은 Durable Object(ImageStore)에 저장됩니다.

## 규칙 세부 (`src/logic.js` 의 `RULES` 에서 변경)
- 입찰 단위 10P, 최고가보다 높아야 하며 최소 입찰가 이상
- 모든 스트리머 최소 입찰가 10 (`minBid`, 유찰 경매 포함). 옵저버가 더 높게만 지정 가능
- 남은 팀원 자리 몫 보존: 최대 입찰 = 보유 − (이번 영입 후 남는 자리 수 × 10). 예) 1,000 보유 첫 영입 최대 980, 980을 쓰면 두 번째 영입은 최대 10
- 입찰 즉시 보유 포인트에서 '보류' 표시, 상위 입찰이 들어오면 반환, 낙찰 시 확정 차감
- 팀당 3명 (`teamSize`) — 3명을 채운 감독은 본 경매에서도 입찰 불가
- 유찰 경매에서 다시 유찰되면 한 바퀴 뒤 재경매. 한 바퀴 동안 낙찰이 하나도 없으면 종료하고 미배정 처리
- 룸 상태는 변경될 때마다 Durable Object 저장소에 저장됩니다. 연결이 끊기면 화면 상단에 표시되고 자동으로 재접속합니다.

## 테스트
```bash
BASE=http://localhost:8787 node test/sim.js   # 규칙 자동 검증 (npm run dev 실행 중, .dev.vars 의 ALLOW_TEST_STREAMERS=1 필요 — 로컬 전용)
BASE=http://localhost:8787 node test/bots.js       # 봇 감독 · 옵저버 정정 검증
BASE=http://localhost:8787 node test/scores.js     # 개인 평가 점수 (옵저버 전용 표시 · 불러오기 · 결과 공개)
BASE=http://localhost:8787 node test/bots-full.js [판수]  # 봇 8명으로 24명 한 판 끝까지 (시세표 기록 확인)
node test/bots-sim.js [판수] [시작 크레딧]       # 서버 없이 봇 8명 경매를 빠르게 여러 판 (유찰 수 · 남은 크레딧 · 성향별 팀 전력 점검)
BASE=http://localhost:8787 node test/demo.js  # 감독 8명 · 스트리머 24명 데모 룸
```

## 효과음
- 파일: `public/sounds/` — `bid`(입찰) · `sold`(낙찰) · `unsold`(유찰) · `tick`(타이머 1초마다)
- 같은 이름으로 덮어쓰고 `npm run deploy`. 형식/음량 변경은 `public/js/config.js` 의 `SOUNDS`
- 틱을 마지막 몇 초만 내려면 `config.js` 의 `TICK_LAST_SECONDS` (0 = 매초)
- 룸 화면: 헤더의 SOUND 버튼으로 켜고 끔 · 오버레이: `?sound=0` 끄기, `?volume=0.5` 음량
- 더미 소리 다시 만들기: `node tools/make-dummy-sounds.js`

## 용어 (크레딧)
- 화면: `public/js/config.js` 의 `CURRENCY` (이름 `크레딧`, 단위 `CR`)
- 서버 로그/오류 문구: `src/logic.js` 의 `CURRENCY` — 두 곳을 같이 바꿔주세요

## 패널 배경 이미지
- `public/backgrounds/` 에 `header`(맨 위 바) · `queue` · `lot`(가운데 현재 경매 스트리머 창) · `log` · `directors` · `teams` 이름으로 이미지(webp/png/jpg/gif)를 넣고 `npm run deploy`
- 이름/패널 연결: `public/js/config.js` 의 `BACKGROUNDS` · 권장 크기는 `public/backgrounds/README.txt`

## 감독 캠 (vdo.ninja)
- 감독: 준비 단계 `내 팀` 패널의 **내 캠 연결하기** → 열린 vdo.ninja 창에서 카메라 선택 후 창을 계속 열어둠 (시청 링크 자동 등록)
  - 이미 쓰는 vdo.ninja 시청 링크가 있으면 붙여넣고 저장
- 옵저버: 감독 카드의 `CAM` 버튼으로 대신 등록/수정 (경매 중에도 가능)
- 표시: 옵저버 화면 좌하단에만 (감독·시청자 화면은 캠을 받지 않음)
- 최고 입찰자(마지막으로 입찰한 감독)의 캠이 나오며, 8명 캠을 미리 연결해 두어 즉시 전환
  - 화면 전환은 0.8초에 한 번보다 자주 일어나지 않음 (연달아 입찰해도 깜빡이지 않도록)
  - 0.8초 동안 A·B 가 번갈아 입찰하면 중간 입찰자는 건너뛰고, 0.8초가 되는 순간의 마지막 입찰자 캠으로 전환 (그 순간 마지막 입찰자가 지금 캠이면 유지)
  - 받는 화질: 최근 8초 안에 입찰한 감독 캠은 고화질, 나머지는 대기 화질 (감독 업로드 부담 조절)
- 설정(`public/js/config.js` 의 `CAM`): 송출 화질(`pushUrl`, 720p) · 받는 화질(`bitrate`) · 고화질 유지 시간(`warmMs`) · 전환 간격(`minSwitchMs`) · 시청 링크 옵션(`&cleanoutput&noaudio`) · 미리 불러오기(`preload`)
