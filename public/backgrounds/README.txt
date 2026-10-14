패널 배경 이미지 폴더

아래 이름으로 이미지를 넣고 npm run deploy 하면 배경이 바뀝니다.
확장자는 webp / png / jpg / jpeg / gif 아무거나 가능합니다. (예: queue.png)

  queue      3단계 경매 순서 (+ 오버레이 '다음 경매 순서')
  lot        3단계 가운데 현재 경매 중인 스트리머 창
  log        3단계 경매 로그
  directors  3단계 감독 표기 창
  teams      5단계 최종 팀 구성

이미지는 패널 크기에 맞춰 꽉 채워집니다(가운데 기준, 넘치는 부분은 잘림).
옵저버 화면(1920x1080) 기준 대략적인 패널 크기:
  queue      약 565 x 480
  lot        약 735 x 480
  log        약 735 x 480
  directors  약 565 x 970
  teams      약 1890 x 880
이름/패널 연결은 public/js/config.js 의 BACKGROUNDS 에서 바꿀 수 있습니다.
