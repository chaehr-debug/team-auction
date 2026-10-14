// 스트리머 사진 목록 생성: public/streamers/ 를 읽어 src/streamer-images.js 를 만든다.
// wrangler dev / deploy 때 자동 실행 (wrangler.jsonc 의 build). 직접 실행: node tools/build-streamers.js
import { readdirSync, writeFileSync } from 'node:fs';
import { STREAMER_NAMES, IMAGE_EXTS } from '../src/roster.js';

const dir = new URL('../public/streamers/', import.meta.url);
const files = new Set(readdirSync(dir).map(f => f.normalize('NFC')));
const map = {};
const missing = [];
for (const name of STREAMER_NAMES) {
  const ext = IMAGE_EXTS.find(e => files.has(`${name}.${e}`));
  if (ext) map[name] = `/streamers/${encodeURIComponent(name)}.${ext}`;
  else missing.push(name);
}
writeFileSync(new URL('../src/streamer-images.js', import.meta.url),
  `// 자동 생성 파일 (tools/build-streamers.js) — 직접 수정하지 마세요\nexport default ${JSON.stringify(map, null, 2)};\n`);
console.log(`스트리머 사진 ${Object.keys(map).length}/${STREAMER_NAMES.length}${missing.length ? ` · 없음: ${missing.join(', ')}` : ''}`);
