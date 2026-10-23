// 실행: node --test test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHighlights, shelve, doneInYear, progressText, progressRatio, bigCover, plainText, RICH_MARK } from "../js/library.js";

test("밀리의 서재: 쪽수·시각 줄로 문장을 나누고, 여러 줄 문장은 이어 붙임", () => {
  const raw = `“
가족주의는 남한뿐만 아니라 북한과 해외동포 사회
에서도 나타난다.
24p · 2026.10.23 18:16

“
즉, 북한은 유교적 심성과 가족주의를 국가의 지배논리로 변화시켰다면, 남한은 공식관계 이면에서 그러한 공식관계를 유지, 재생산하기 위한 기제로 활용하고 있다.
24p • 2026.10.23 18:16`;
  const r = parseHighlights(raw);
  assert.equal(r.length, 2);
  assert.equal(r[0].text, "가족주의는 남한뿐만 아니라 북한과 해외동포 사회 에서도 나타난다.");
  assert.equal(r[0].page, 24);
  assert.equal(r[0].highlighted_at, "2026-10-23T09:16:00.000Z"); // 한국 18:16
  assert.match(r[1].text, /^즉, 북한은/);
});

test("쪽수·시각이 없으면 빈 줄로, 빈 줄도 없으면 한 줄씩", () => {
  assert.deepEqual(parseHighlights("첫 문장\n둘째 문장\n\n").map((h) => h.text), ["첫 문장", "둘째 문장"]);
  const blocks = parseHighlights("한 문장이\n두 줄로\n\n\"다음 문장\"\n52쪽");
  assert.deepEqual(blocks.map((h) => [h.text, h.page]), [["한 문장이 두 줄로", null], ["다음 문장", 52]]);
  assert.deepEqual(parseHighlights("  \n "), []);
});

test("출처·링크 같은 군더더기 줄은 버림", () => {
  const r = parseHighlights("좋은 문장\n출처: 밀리의 서재\nhttps://millie.page.link/abc\n10p · 2026.1.5 9:03");
  assert.deepEqual(r.map((h) => [h.text, h.page]), [["좋은 문장", 10]]);
});

test("서재 정리와 올해 권수", () => {
  const books = [
    { id: 1, status: "done", finished_on: "2026-03-01" },
    { id: 2, status: "done", finished_on: "2026-10-20" },
    { id: 3, status: "done", finished_on: "2025-12-31" },
    { id: 4, status: "reading", updated_at: "2026-10-23" },
    { id: 5, status: "want" },
  ];
  const s = shelve(books);
  assert.deepEqual(s.done.map((b) => b.id), [2, 1, 3]);
  assert.deepEqual(s.reading.map((b) => b.id), [4]);
  assert.equal(doneInYear(books, 2026), 2);
});

test("진도는 %가 기본, 종이책은 쪽수", () => {
  assert.equal(progressText({ progress_unit: "percent", progress: 52 }), "52%");
  assert.equal(progressText({ progress_unit: "percent", progress: 140 }), "100%");
  assert.equal(progressText({ progress_unit: "page", progress: 120, total_pages: 340 }), "120/340쪽");
  assert.equal(progressRatio({ progress_unit: "page", progress: 170, total_pages: 340 }), 0.5);
});

test("카카오 표지는 큰 크기로, 감상은 글자만 뽑기", () => {
  assert.equal(bigCover("https://search1.kakaocdn.net/thumb/R120x174.q85/?fname=x"), "https://search1.kakaocdn.net/thumb/R360x520.q85/?fname=x");
  assert.equal(bigCover("https://example.com/a.jpg"), "https://example.com/a.jpg");
  assert.equal(plainText(`${RICH_MARK}<div><b>좋았다</b> &amp; 슬펐다</div>`), "좋았다 & 슬펐다");
});
