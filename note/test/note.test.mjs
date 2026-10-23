// 실행: node --test test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { textStats, plainText, RICH_MARK, postFields, sameFields, isBlank, readLocalDraft, pickResume, filterPosts, monthReport, shiftMonth, kstDay, isMonth } from "../js/note.js";

test("글자 수: 공백 포함(줄바꿈 제외), 공백 제외, 단어", () => {
  assert.deepEqual(textStats("가을 바람\n좋다"), { chars: 7, noSpace: 6, words: 3 });
  assert.deepEqual(textStats(`${RICH_MARK}<div><b>안녕</b> 하세요</div><div>a&amp;b</div>`), { chars: 9, noSpace: 8, words: 3 });
  assert.deepEqual(textStats(""), { chars: 0, noSpace: 0, words: 0 });
  assert.equal(textStats("😀 a").chars, 3); // 이모지는 한 글자
  assert.equal(plainText(`${RICH_MARK}<div>x</div>`), "x");
});

test("글 칸 정리와 비교", () => {
  const f = postFields({ title: "t", purpose: "과제", content: "c", weather: "sunny", photos: ["a", 3], written_on: "2026-10-03" });
  assert.deepEqual(f, { title: "t", purpose: "과제", content: "c", photos: ["a"], folder_id: null, written_on: "2026-10-03" });
  assert.equal(postFields({ purpose: 3 }).purpose, "");
  assert.ok(sameFields(f, { ...f, extra: 1 }));
  assert.ok(!sameFields(f, { ...f, title: "u" }));
  assert.ok(isBlank(postFields({ written_on: "2026-01-01" })));
  assert.ok(!isBlank(postFields({ title: " x" })));
  assert.ok(!isBlank(postFields({ purpose: "목적만" })));
});

test("이 기기 임시저장은 더 새로울 때만", () => {
  const raw = JSON.stringify({ updatedAt: 2000, fields: { title: "a", content: "b", written_on: "2026-10-01" } });
  assert.equal(readLocalDraft(raw, 1000).fields.title, "a");
  assert.equal(readLocalDraft(raw, 3000), null);
  assert.equal(readLocalDraft("{bad", 0), null);
  assert.equal(readLocalDraft(JSON.stringify({ updatedAt: 1, fields: { title: 1 } })), null);
});

test("이어 쓸 내용: 글보다 새로운 자동 저장·임시저장 중 가장 최근 것", () => {
  const post = { title: "올림", content: "x", written_on: "2026-10-01", updated_at: "2026-10-02T00:00:00Z" };
  const versions = [
    { id: "a", kind: "auto", updated_at: "2026-10-03T00:00:00Z", fields: { ...post, title: "자동" } },
    { id: "b", kind: "manual", updated_at: "2026-10-01T00:00:00Z", fields: { ...post, title: "옛 임시" } },
    { id: "c", kind: "publish", updated_at: "2026-10-09T00:00:00Z", fields: { ...post, title: "올림 버전" } },
  ];
  assert.equal(pickResume(post, versions, null).fields.title, "자동");
  const local = { at: Date.parse("2026-10-04T00:00:00Z"), fields: postFields({ ...post, title: "이 기기" }) };
  assert.equal(pickResume(post, versions, local).source, "local");
  assert.equal(pickResume(post, [], null), null);
  // 글과 같은 내용이면 굳이 알리지 않음
  assert.equal(pickResume(post, [{ id: "d", kind: "auto", updated_at: "2026-10-05T00:00:00Z", fields: post }], null), null);
  // 새 글: 이 기기 내용만
  assert.equal(pickResume(null, [], { at: 5, fields: postFields({ title: "새" }) }).fields.title, "새");
});

const posts = [
  { id: 1, folder_id: "f1", status: "published", written_on: "2026-10-03", title: "가을", purpose: "공모전", content: "바람 분다", updated_at: "1" },
  { id: 2, folder_id: null, status: "published", written_on: "2026-10-12", title: "보고서", content: "세포 막", updated_at: "1" },
  { id: 3, folder_id: "f1", status: "draft", written_on: "2026-10-20", title: "초안", content: "아직", updated_at: "1" },
  { id: 4, folder_id: "f1", status: "published", written_on: "2026-09-30", title: "구월", content: "끝", updated_at: "1" },
];

test("목록과 검색: 폴더, 임시저장, 글자(목적 포함), 기간", () => {
  assert.deepEqual(filterPosts(posts).map((p) => p.id), [3, 2, 1, 4]);
  assert.deepEqual(filterPosts(posts, { folder: "f1" }).map((p) => p.id), [3, 1, 4]);
  assert.deepEqual(filterPosts(posts, { folder: "none" }).map((p) => p.id), [2]);
  assert.deepEqual(filterPosts(posts, { folder: "drafts" }).map((p) => p.id), [3]);
  assert.deepEqual(filterPosts(posts, { drafts: false }).map((p) => p.id), [2, 1, 4]);
  assert.deepEqual(filterPosts(posts, { q: "세포" }).map((p) => p.id), [2]);
  assert.deepEqual(filterPosts(posts, { from: "2026-10-01", to: "2026-10-10" }).map((p) => p.id), [1]);
  assert.deepEqual(filterPosts(posts, { q: "공모" }).map((p) => p.id), [1]);
});

test("월간 리포트: 그달에 올린 글만, 글자·단어 합계와 날짜별·폴더별", () => {
  const r = monthReport(posts, "2026-10", [{ id: "f1", name: "에세이", color: "#000000" }]);
  assert.equal(r.count, 2);
  assert.deepEqual([r.chars, r.noSpace, r.words], [5 + 4, 4 + 3, 4]);
  assert.equal(r.byDay.length, 31);
  assert.deepEqual(r.byDay.filter((d) => d.count).map((d) => [d.day, d.chars]), [["2026-10-03", 5], ["2026-10-12", 4]]);
  assert.deepEqual(r.byFolder.map((g) => [g.name, g.count, g.chars]), [["에세이", 1, 5], ["폴더 없음", 1, 4]]);
  assert.equal(r.days, 2);
  assert.equal(r.longest.id, 1);
  assert.equal(monthReport(posts, "2026-11").count, 0);
});

test("달·날짜 도우미", () => {
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(kstDay(Date.parse("2026-10-23T15:30:00Z")), "2026-10-24");
  assert.ok(isMonth("2026-10") && !isMonth("2026-13"));
});
