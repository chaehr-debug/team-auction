효과음 폴더

  bid.wav     입찰할 때
  sold.wav    낙찰될 때
  unsold.wav  유찰될 때
  tick.wav    타이머가 1초 줄어들 때마다

바꾸는 방법
  1) 같은 이름의 파일로 덮어쓰기 → npm run deploy
  2) mp3/ogg 등 다른 형식이면 public/js/config.js 의 SOUNDS 에서 파일 경로와 음량(volume)을 수정

현재 파일은 tools/make-dummy-sounds.js 로 만든 임시 소리입니다.
