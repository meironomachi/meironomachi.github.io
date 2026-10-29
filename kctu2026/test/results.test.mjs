// 실행: node --test kctu2026/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { count, judgeFirst, judgeRunoff, headline } from "../results.js";

test("단독 과반이면 1차에서 당선", () => {
  const d = { first: { votes: { 1: 100, 2: 260, 3: 80, 4: 60 }, final: true } };
  const f = judgeFirst(d);
  assert.equal(f.valid, 500);
  assert.equal(f.winner, 2);
  assert.equal(f.runoff, null);
  assert.deepEqual(f.rows.map((r) => r.n), [2, 1, 3, 4]);
  assert.equal(Math.round(f.rows[0].pct), 52);
  assert.deepEqual(headline(f), { kind: "won", n: 2, text: "기호 2번 후보조 당선 (1차 과반)" });
});

test("정확히 절반은 과반이 아님 → 1·2위 결선", () => {
  const f = judgeFirst({ first: { votes: { 1: 250, 2: 150, 3: 60, 4: 40 }, final: true } });
  assert.equal(f.winner, null);
  assert.deepEqual(f.runoff, [1, 2]);
  assert.equal(headline(f).text, "과반 후보조 없음 · 기호 1번과 2번 결선 진출");
});

test("기본은 총 투표수 기준: 무효표까지 분모에 들어감", () => {
  const d = { first: { votes: { 1: 260, 2: 140, 3: 50, 4: 50 }, invalid: 30, final: true } };
  const f = judgeFirst(d);
  assert.equal(f.base, 530);
  assert.equal(f.winner, null); // 260 / 530 < 50%
  assert.equal(judgeFirst({ ...d, basis: "valid" }).winner, 1); // 유효표 기준이면 52%
});

test("2위 동률이면 결선 진출 팀을 정하지 못함", () => {
  const f = judgeFirst({ first: { votes: { 1: 200, 2: 120, 3: 120, 4: 60 }, final: true } });
  assert.equal(f.tie, "second");
  assert.equal(headline(f).kind, "tie");
});

test("개표 중 표시와 개표 전", () => {
  assert.equal(headline(judgeFirst({})).kind, "before");
  const live = judgeFirst({ first: { votes: { 1: 30, 2: 10 } } });
  assert.equal(headline(live).text, "개표 중 · 기호 1번 과반 앞섬");
  const live2 = judgeFirst({ first: { votes: { 1: 30, 2: 25, 3: 20 } } });
  assert.equal(headline(live2).kind, "lead");
});

test("결선: 많이 얻은 쪽 당선, 동률은 따로 표시", () => {
  const d = { first: { votes: { 1: 220, 2: 200, 3: 50, 4: 30 }, final: true }, runoff: { votes: { 1: 240, 2: 260 }, final: true } };
  const f = judgeFirst(d), r = judgeRunoff(d, f.runoff);
  assert.equal(r.winner, 2);
  assert.equal(headline(f, r).text, "기호 2번 후보조 당선 (결선)");
  const t = judgeRunoff({ runoff: { votes: { 1: 250, 2: 250 }, final: true } }, [1, 2]);
  assert.equal(headline(f, t).kind, "tie");
  assert.equal(count({ 1: "abc", 2: -5, 3: 12.7 }, [1, 2, 3]).valid, 12); // 이상한 값은 0, 소수는 버림
});

test("퍼센트로 넣으면 표 수로 바뀜 (모의)", async () => {
  const { fromPercents } = await import("../results.js");
  const r = fromPercents({ eligible: 977175, turnoutPct: 70, pcts: { 1: 30, 2: 40, 3: 12, 4: 15 } }, [1, 2, 3, 4]);
  assert.equal(r.error, null);
  assert.equal(r.turnout, 684023); // 977,175 × 70% (반올림)
  assert.equal(r.votes[2], Math.round(684023 * 0.4));
  assert.equal(r.invalid, 684023 - Object.values(r.votes).reduce((a, v) => a + v, 0)); // 3%
  assert.equal(Math.round(r.invalidPct), 3);
  // 1차 판정: 40%는 총 투표수 과반이 아님 → 1·2위 결선
  const f = judgeFirst({ first: { votes: r.votes, turnout: r.turnout, invalid: r.invalid, final: true } });
  assert.deepEqual(f.runoff, [1, 2]);
  assert.match(fromPercents({ eligible: 100, turnoutPct: 50, pcts: { 1: 60, 2: 50 } }, [1, 2]).error, /100%를 넘어요/);
  assert.match(fromPercents({ eligible: 100, turnoutPct: 0, pcts: { 1: 60 } }, [1]).error, /투표율/);
  assert.match(fromPercents({ eligible: 100, turnoutPct: 50, pcts: { 1: 60 } }, [1, 2]).error, /모두/);
});
