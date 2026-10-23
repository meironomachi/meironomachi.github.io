// 올리기 전에 실행: node tools/bump-version.mjs
// css·js 주소 끝의 ?v=값을 바꿔서, 브라우저가 예전 파일을 쓰지 않고 새 파일을 받게 함
import { readFileSync, writeFileSync } from "node:fs";

const v = new Date().toISOString().replace(/\D/g, "").slice(0, 12);
const files = ["index.html", "js/app.js"];
for (const f of files) {
  const before = readFileSync(f, "utf8");
  const after = before
    .replace(/((?:href|src)="(?:css|js)\/[\w-]+\.(?:css|js))(?:\?v=\w+)?"/g, `$1?v=${v}"`)
    .replace(/(from "\.\/[\w-]+\.js)(?:\?v=\w+)?"/g, `$1?v=${v}"`);
  if (after !== before) writeFileSync(f, after);
}
console.log(`버전 ${v}`);
