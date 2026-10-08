// 패널 배경 이미지 적용 — public/backgrounds/ 에 있는 파일을 찾아 해당 패널 배경으로 지정
import { BACKGROUNDS, BACKGROUND_EXTS } from './config.js';

const probe = url => new Promise(res => {
  const img = new Image();
  img.onload = () => res(true);
  img.onerror = () => res(false);
  img.src = url;
});

export async function applyBackgrounds() {
  const rules = [];
  await Promise.all(Object.values(BACKGROUNDS).map(async ({ file, panels }) => {
    for (const ext of BACKGROUND_EXTS) {
      const url = `/backgrounds/${file}.${ext}`;
      if (await probe(url)) {
        rules.push(`${panels.map(p => `[data-panel="${p}"]`).join(', ')} { --panel-img: url("${url}"); }`);
        return;
      }
    }
  }));
  const style = document.createElement('style');
  style.textContent = rules.join('\n');
  document.head.appendChild(style);
}
