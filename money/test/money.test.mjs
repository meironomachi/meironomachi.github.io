// 실행: node --test test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseBankRows, parseAmount, parseKstDateTime, kstDay, kstMonth, monthRange, shiftMonth, importKey, classify, normalizePlace,
  findCancelPairs, findTransferPairs, findManualMatch, fromScreenshotRows, parsePastedHistory, monthSummary, budgetStatus, changeRate, accountBalance, frequentEntries, signedWon,
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

test("고정 수입·지출: 시작~끝 달, 날짜가 지난 달만 내역으로", async () => {
  const { recurringDay, recurringActive, recurringDueMonths, recurringTx, recurringTotals } = await import("../js/money.js");
  const allowance = { id: "r1", kind: "income", amount: 300000, day: 1, start_month: "2026-11", end_month: null, account_id: "k", category_id: "c", name: "용돈" };
  const rent = { id: "r2", kind: "expense", amount: 400000, day: 31, start_month: "2026-11", end_month: "2027-02", account_id: "k", category_id: "h", name: "월세" };
  assert.equal(recurringDay(rent, "2026-11"), "2026-11-30"); // 31일 → 30일까지인 달
  assert.equal(recurringDay(rent, "2027-02"), "2027-02-28");
  assert.equal(recurringActive(rent, "2027-02"), true);
  assert.equal(recurringActive(rent, "2027-03"), false);
  assert.equal(recurringActive(allowance, "2030-01"), true); // 끝 없음
  assert.deepEqual(recurringDueMonths(allowance, "2026-10-23"), []); // 아직 시작 전
  assert.deepEqual(recurringDueMonths(allowance, "2027-01-01"), ["2026-11", "2026-12", "2027-01"]);
  assert.deepEqual(recurringDueMonths(rent, "2026-12-15"), ["2026-11"]); // 12월 31일은 아직
  assert.deepEqual(recurringDueMonths(rent, "2027-05-01"), ["2026-11", "2026-12", "2027-01", "2027-02"]); // 2월에서 끝
  const t = recurringTx(rent, "2026-11");
  assert.deepEqual([t.amount, t.kind, t.occurred_at, t.recurring_month], [-400000, "expense", "2026-11-30T00:00:00.000Z", "2026-11"]);
  assert.equal(recurringTx(allowance, "2026-11").amount, 300000);
  assert.deepEqual(recurringTotals([allowance, rent], "2026-12"), { income: 300000, expense: 400000, saving: 0 });
  assert.deepEqual(recurringTotals([allowance, rent], "2027-03"), { income: 300000, expense: 0, saving: 0 });
});

test("수입·저축 목표", async () => {
  const { goalStatus, inflowByCat } = await import("../js/money.js");
  assert.equal(goalStatus(300000, 300000).state, "done");
  assert.equal(goalStatus(85000, 100000).state, "near");
  assert.equal(goalStatus(10, 100).state, "ok");
  assert.deepEqual(inflowByCat([{ kind: "income", amount: 300000, category_id: "pocket" }, { kind: "saving", amount: -50000, category_id: "save" }, { kind: "expense", amount: -1, category_id: "x" }]), { pocket: 300000, save: 50000 });
});

test("캡처에서 읽은 줄: 한국 시각으로, 겹친 줄은 하나만, 금액 없는 줄은 뺌", () => {
  const items = fromScreenshotRows([
    { date: "2026-10-28", time: "14:03", amount: -4500, counterparty: " 메가커피 ", balance_after: 120000, tx_type: "체크카드" },
    { date: "2026-10-28", time: "14:03", amount: -4500, counterparty: "메가커피", balance_after: 120000, tx_type: "체크카드" },
    { date: "2026-10-28", time: "", amount: 30000, counterparty: "홍길동", balance_after: null, tx_type: "" },
    { date: "2026-10-27", time: "09:00", amount: 0, counterparty: "?", balance_after: null, tx_type: "" },
    { date: "", time: "09:00", amount: -100, counterparty: "?", balance_after: null, tx_type: "" },
  ]);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { occurred_at: "2026-10-28T05:03:00.000Z", amount: -4500, balance_after: 120000, tx_type: "체크카드", place: "메가커피", memo: "" });
  assert.equal(items[1].occurred_at, "2026-10-27T15:00:00.000Z");
  assert.equal(items[1].balance_after, null);
});

test("붙여넣기: 하나원큐 (날짜 줄 아래 시각, +/− 금액, 잔액, 메모)", () => {
  const text = `5:32
지금입장
거래내역조회
1개월 전체 최신순
2026.10.01~2026.10.30
잔액
13:29:25
체크카드
(주)맘스터치
-7,700원
0원
13:26:39
대체
김도현
+600원
7,700원
2026.10.26 (월)
21:51:00
대체
토스 김도현
-5,000원
20,000원
(비바리퍼블리카-오픈뱅킹)
16:42:28 대체
토스 김도현 -4,775원
25,000원
(비바리퍼블리카-오픈뱅킹)`;
  const rows = parsePastedHistory(text);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { date: "", time: "13:29:25", amount: -7700, place: "(주)맘스터치", balance_after: 0, tx_type: "체크카드", memo: "" });
  assert.equal(rows[1].amount, 600);
  assert.deepEqual(rows[2], { date: "2026-10-26", time: "21:51:00", amount: -5000, place: "토스 김도현", balance_after: 20000, tx_type: "대체", memo: "비바리퍼블리카-오픈뱅킹" });
  assert.deepEqual([rows[3].time, rows[3].amount, rows[3].balance_after, rows[3].place], ["16:42:28", -4775, 25000, "토스 김도현"]);
});

test("붙여넣기: NH (줄마다 날짜·시각, 들어온 돈은 부호 없음, 금액 없는 끝 줄은 뺌)", () => {
  const text = `입출금 거래내역 조회
2026.10.16 15:11
김도현
-34,000원
0원
2026.10.16 15:06
김도현
34,000원
34,000원
2026.10.14 10:14
NHK패스환급
88,000원
88,000원
2026.10.01 17:49`;
  const rows = parsePastedHistory(text);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { date: "2026-10-16", time: "15:11", amount: -34000, place: "김도현", balance_after: 0, tx_type: "", memo: "" });
  assert.equal(rows[1].amount, 34000);
  assert.equal(rows[2].place, "NHK패스환급");
  // 같은 글자를 두 번 붙여도 한 번만
  assert.equal(parsePastedHistory(text + "\n" + text).length, 3);
});
