// 실행: node --test test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseBankRows, parseAmount, parseKstDateTime, kstDay, kstMonth, monthRange, shiftMonth, importKey, classify, normalizePlace,
  findCancelPairs, findTransferPairs, findManualMatch, monthSummary, budgetStatus, changeRate, accountBalance, frequentEntries, signedWon,
} from "../js/money.js";

// 보내 주신 카카오뱅크 캡처와 같은 모양 (내용 칸은 예시)
const kakao = [
  ["카카오뱅크 거래내역"],
  ["조회기간", "2026.10.01 ~ 2026.10.31"],
  [],
  ["거래일시", "구분", "거래금액", "거래 후 잔액", "거래구분", "내용", "메모"],
  ["2026.10.01 00:05:06", "출금", "-9,900", "41,909", "체크카드결제", "넷플릭스", ""],
  ["2026.10.01 07:03:24", "입금", "300,000", "341,909", "일반입금", "엄마", "용돈"],
  ["2026.10.01 08:32:19", "출금", "-50,000", "291,909", "자동이체(기타)", "자유적금", ""],
  ["2026.10.01 10:01:08", "출금", "-13,800", "278,109", "체크카드결제", "올리브영", ""],
  ["2026.10.01 10:01:10", "입금", "13,800", "291,909", "체크카드(기타)", "올리브영", ""],
  ["2026.10.01 10:33:54", "출금", "-13,400", "278,509", "체크카드결제", "스타벅스", ""],
];

test("카카오뱅크 파일: 제목 줄을 찾고 금액·잔액·내용을 읽음", () => {
  const { error, items } = parseBankRows(kakao);
  assert.equal(error, null);
  assert.equal(items.length, 6);
  assert.deepEqual(items[0], { occurred_at: "2026-09-30T15:05:06.000Z", amount: -9900, balance_after: 41909, tx_type: "체크카드결제", place: "넷플릭스", memo: "" });
  assert.equal(items[1].amount, 300000);
  assert.equal(items[1].memo, "용돈");
});

test("출금액·입금액이 따로 있는 은행 파일도 읽음", () => {
  const { items } = parseBankRows([
    ["거래일자", "거래시간", "적요", "출금액", "입금액", "잔액", "거래내용"],
    ["2026-10-02", "13:00", "체크", "5,000", "0", "95,000", "편의점"],
    ["2026-10-03", "09:10:00", "이체", "", "20,000", "115,000", "홍길동"],
  ]);
  assert.deepEqual(items.map((t) => [t.amount, t.balance_after, t.place]), [[-5000, 95000, "편의점"], [20000, 115000, "홍길동"]]);
});

test("파일이 아니면 알려 줌", () => {
  assert.match(parseBankRows([["이름", "나이"], ["a", "1"]]).error, /찾지 못했어요/);
});

test("금액·날짜 도우미", () => {
  assert.equal(parseAmount("-9,900"), -9900);
  assert.equal(parseAmount("1,000원"), 1000);
  assert.equal(parseAmount(""), null);
  assert.equal(parseKstDateTime("2026.10.01 07:03:24"), "2026-09-30T22:03:24.000Z");
  assert.equal(kstDay("2026-09-30T22:03:24.000Z"), "2026-10-01");
  assert.equal(kstMonth("2026-09-30T15:05:06.000Z"), "2026-10");
  assert.deepEqual(monthRange("2026-10"), ["2026-09-30T15:00:00.000Z", "2026-10-31T15:00:00.000Z"]);
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(signedWon(-13400), "−13,400원");
});

test("결제 뒤 바로 들어온 같은 금액은 취소 짝", () => {
  const items = parseBankRows(kakao).items.map((t) => ({ ...t, account_id: "k" }));
  const pairs = findCancelPairs(items);
  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0].map((t) => t.amount), [-13800, 13800]);
});

test("다른 내 계좌로 10분 안에 같은 금액이 들어오면 이체 짝", () => {
  const txs = [
    { id: 1, account_id: "kakao", amount: -100000, occurred_at: "2026-10-05T03:00:00Z" },
    { id: 2, account_id: "hana", amount: 100000, occurred_at: "2026-10-05T03:00:40Z" },
    { id: 3, account_id: "hana", amount: 100000, occurred_at: "2026-10-05T05:00:00Z" }, // 시간이 멀어서 아님
  ];
  assert.deepEqual(findTransferPairs(txs).map(([o, i]) => [o.id, i.id]), [[1, 2]]);
});

test("손으로 넣은 거래와 파일의 같은 거래 맞추기", () => {
  const manuals = [
    { id: "m1", account_id: "k", amount: -13400, occurred_at: "2026-10-01T02:00:00Z" },
    { id: "m2", account_id: "k", amount: -13400, occurred_at: "2026-10-04T02:00:00Z" },
  ];
  const t = { account_id: "k", amount: -13400, occurred_at: "2026-10-01T01:33:54Z" };
  assert.equal(findManualMatch(t, manuals).id, "m1");
  assert.equal(findManualMatch(t, manuals, new Set(["m1"])), null);
});

test("분류: 내 규칙이 먼저, 적금은 저축, 입금은 수입", () => {
  const cats = [{ id: "c-cafe", name: "카페" }, { id: "c-save", name: "저축" }, { id: "c-pocket", name: "용돈" }];
  const rules = [{ place: normalizePlace("스타 벅스"), kind: "expense", category_id: "c-cafe" }];
  assert.deepEqual(classify({ amount: -13400, place: "스타벅스", tx_type: "체크카드결제" }, rules, cats), { kind: "expense", category_id: "c-cafe" });
  assert.deepEqual(classify({ amount: -50000, place: "자유적금", tx_type: "자동이체(기타)" }, [], cats), { kind: "saving", category_id: "c-save" });
  assert.equal(classify({ amount: 300000, place: "엄마", tx_type: "일반입금" }, [], cats).kind, "income");
});

test("한 달 요약은 이체·저축·취소를 지출에서 뺌", () => {
  const s = monthSummary([
    { kind: "income", amount: 300000 }, { kind: "expense", amount: -9900, category_id: "sub" }, { kind: "expense", amount: -13400, category_id: "cafe" },
    { kind: "saving", amount: -50000 }, { kind: "cancel", amount: -13800 }, { kind: "cancel", amount: 13800 }, { kind: "transfer", amount: -100000 },
  ]);
  assert.deepEqual(s, { income: 300000, expense: 23300, net: 276700, saving: 50000, byCat: { sub: 9900, cafe: 13400 } });
});

test("예산 상태, 지난달 대비, 계좌 잔액, 자주 쓰는 내역", () => {
  assert.equal(budgetStatus(70000, 100000).state, "ok");
  assert.equal(budgetStatus(85000, 100000).state, "warn");
  assert.equal(budgetStatus(120000, 100000).state, "over");
  assert.equal(changeRate(112, 100), 12);
  assert.equal(changeRate(5, 0), null);
  const acc = { id: "k", opening_balance: 0 };
  assert.equal(accountBalance(acc, [
    { account_id: "k", amount: -9900, balance_after: 41909, occurred_at: "2026-10-01T00:00:00Z" },
    { account_id: "k", amount: -3000, balance_after: null, occurred_at: "2026-10-02T00:00:00Z" },
  ]), 38909);
  assert.equal(accountBalance({ id: "cash", opening_balance: 50000 }, [{ account_id: "cash", amount: -4500, occurred_at: "2026-10-02T00:00:00Z" }]), 45500);
  const fq = frequentEntries([{ kind: "expense", place: "편의점", amount: -3000 }, { kind: "expense", place: "편의점", amount: -2500 }, { kind: "expense", place: "버스", amount: -1500 }]);
  assert.deepEqual(fq.map((f) => [f.place, f.n]), [["편의점", 2], ["버스", 1]]);
  assert.equal(importKey("k", { occurred_at: "x", amount: -1, balance_after: 5 }), "k|x|-1|5");
});
