// 고정 스트리머 명단 — 모든 룸은 이 24명으로 만들어진다 (경매 순서 기본값도 이 순서)
// 프로필 사진: public/streamers/ 에 "스트리머명.확장자" 로 넣고 배포 (예: 플라이.png)
// nick: 이터널 리턴 인게임 닉네임 (dak.gg 검색용 — https://dak.gg/er/players/닉네임)
export const ROSTER = [
  { name: '플라이', nick: '검은머리사나이' },
  { name: '베릴', nick: 'BeryL22' },
  { name: '피닉스박', nick: '피닉스박93' },
  { name: '갱맘', nick: '초누력' },
  { name: '이로클라우드', nick: '김이로' },
  { name: '노페', nick: '노페' },
  { name: '네브짱', nick: '네브짱' },
  { name: '자연', nick: '자연' },
  { name: '후참', nick: '후참' },
  { name: '큐베', nick: '돼지여우' },
  { name: '방찌', nick: '방찌' },
  { name: '유세라', nick: '메세지' },
  { name: '앰비션', nick: '눌은밥' },
  { name: '눈가루', nick: '눙가루' },
  { name: '플레임', nick: '플레임임' },
  { name: '마린', nick: 'MaRinCHZZK' },
  { name: '왈도쿤', nick: '머장' },
  { name: '쾅준', nick: '쾅준' },
  { name: '이로나묭 치카', nick: '마왕치카' },
  { name: '고수달', nick: '고문탁1' },
  { name: '위구리', nick: '상근예비역' },
  { name: '모카형', nick: '조심해' },
  { name: '감규리', nick: '규리규리' },
  { name: '스나랑', nick: '카리나랑' },
];
export const STREAMER_NAMES = ROSTER.map(r => r.name);

// 대회용 경매 순서 — 준비 단계 '🏆 대회용' 버튼 + 비밀번호로 적용 (서버에서만 확인, 화면 코드에는 보내지 않음)
export const TOURNAMENT = {
  password: '2784616',
  order: [
    '마린', '후참', '자연', '감규리', '왈도쿤', '앰비션', '플라이', '위구리',
    '고수달', '이로나묭 치카', '갱맘', '네브짱', '베릴', '스나랑', '피닉스박', '방찌',
    '이로클라우드', '눈가루', '큐베', '쾅준', '모카형', '플레임', '노페', '유세라',
  ],
};

export const IMAGE_EXTS = ['webp', 'png', 'jpg', 'jpeg', 'gif'];
