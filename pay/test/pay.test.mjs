// 실행: node --test test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { shiftMinutes, shiftPay, weeklyAllowances, deductions, incomeTaxMonthly, monthSummary, compare, monthCells, weekStart, dayTotals, hoursText } from "../js/pay.js";

const cafe = { id: "c", wage: 10320, tax_type: "biz33", weekly: true, extra: false };
const pub = { id: "p", wage: 12000, tax_type: "insured", weekly: false, extra: true, night: true };

test("근무 시간: 휴게 빼기, 자정 넘김, 야간(22~06시)", () => {
  assert.deepEqual(shiftMinutes({ start_time: "09:00", end_time: "18:00", break_min: 60 }), { work: 480, night: 0 });
  assert.deepEqual(shiftMinutes({ start_time: "18:00", end_time: "02:00", break_min: 0 }), { work: 480, night: 240 });
  // 휴게는 낮 시간에서 먼저 뺌
  assert.deepEqual(shiftMinutes({ start_time: "21:00", end_time: "23:00", break_min: 90 }), { work: 30, night: 30 });
  assert.deepEqual(shiftMinutes({ start_time: "04:00", end_time: "08:00", break_min: 0 }), { work: 240, night: 120 });
  assert.equal(hoursText(270), "4시간 30분");
});

test("하루 돈: 연장·야간 0.5배를 따로 켜고 끔", () => {
  const a = shiftPay({ start_time: "09:00", end_time: "13:30", break_min: 0 }, cafe);
  assert.deepEqual([a.base, a.overtime, a.nightPay, a.total], [46440, 0, 0, 46440]);
  // 14:00~02:00, 휴게 60분 → 11시간, 야간 4시간, 연장 3시간
  const b = shiftPay({ start_time: "14:00", end_time: "02:00", break_min: 60 }, pub);
  assert.deepEqual([b.work, b.night, b.base, b.overtime, b.nightPay], [660, 240, 132000, 18000, 24000]);
  // 야간수당만 끄기, 연장수당만 끄기
  const b2 = shiftPay({ start_time: "14:00", end_time: "02:00", break_min: 60 }, { ...pub, night: false });
  assert.deepEqual([b2.overtime, b2.nightPay, b2.total], [18000, 0, 150000]);
  const b3 = shiftPay({ start_time: "14:00", end_time: "02:00", break_min: 60 }, { ...pub, extra: false });
  assert.deepEqual([b3.overtime, b3.nightPay, b3.total], [0, 24000, 156000]);
  // 야간 칸이 비어 있으면(처음 만든 곳) 연장수당 설정을 따라감
  const { night: _n, ...old } = pub;
  assert.equal(shiftPay({ start_time: "14:00", end_time: "02:00", break_min: 60 }, old).nightPay, 24000);
  // 그 날만 다른 시급
  assert.equal(shiftPay({ start_time: "09:00", end_time: "10:00", wage: 15000 }, cafe).total, 15000);
});

const s = (date, start, end, place = "c", brk = 0) => ({ work_date: date, start_time: start, end_time: end, break_min: brk, place_id: place });

test("주휴수당: 주 15시간 이상, 주 근무시간/40×8시간, 일요일이 속한 달", () => {
  const shifts = [
    // 2026-10-26(월)~11-01(일): 5시간 × 4일 = 20시간 → 4시간분
    s("2026-10-26", "10:00", "15:00"), s("2026-10-27", "10:00", "15:00"), s("2026-10-29", "10:00", "15:00"), s("2026-11-01", "10:00", "15:00"),
    // 10-19 주: 10시간뿐 → 없음
    s("2026-10-19", "10:00", "15:00"), s("2026-10-20", "10:00", "15:00"),
  ];
  const w = weeklyAllowances(shifts, cafe);
  assert.equal(w.length, 1);
  assert.deepEqual([w[0].monday, w[0].sunday, w[0].amount], ["2026-10-26", "2026-11-01", 4 * 10320]);
  assert.equal(weeklyAllowances(shifts, { ...cafe, weekly: false }).length, 0);
  // 40시간 넘어도 8시간까지만
  const full = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"].map((d) => s(d, "09:00", "18:00", "c", 60));
  assert.equal(weeklyAllowances(full, cafe)[0].amount, 8 * 10320);
  assert.equal(weekStart("2026-11-01"), "2026-10-26");
});

test("세금: 3.3%, 4대보험, 없음", () => {
  assert.deepEqual(deductions(1000000, "biz33").items.map((x) => x.amount), [30000, 3000]);
  assert.equal(deductions(1000000, "none").total, 0);
  const ins = deductions(2000000, "insured");
  const by = Object.fromEntries(ins.items.map((x) => [x.name.split(" ")[0], x.amount]));
  assert.equal(by["국민연금"], 95000);
  assert.equal(by["건강보험"], 71900);
  assert.equal(by["장기요양보험"], 9440);
  assert.equal(by["고용보험"], 18000);
  // 월 100만 원 정도는 근로소득세 0, 월 300만 원은 수만 원대
  assert.equal(incomeTaxMonthly(1000000, 47500), 0);
  const t3 = incomeTaxMonthly(3000000, 142500);
  assert.ok(t3 > 30000 && t3 < 90000, `월 300만 원 소득세 ${t3}`);
  assert.equal(by["근로소득세"] % 10, 0);
});

test("한 달 합계와 전월 대비", () => {
  const shifts = [
    s("2026-10-05", "09:00", "18:00", "c", 60), s("2026-10-06", "09:00", "18:00", "c", 60),
    s("2026-10-10", "18:00", "02:00", "p"),
    s("2026-09-10", "09:00", "13:00", "c"),
  ];
  const oct = monthSummary(shifts, [cafe, pub], "2026-10");
  assert.equal(oct.byPlace.length, 2);
  const c = oct.byPlace.find((x) => x.place.id === "c");
  assert.equal(c.weekly, Math.round(16 / 40 * 8 * 10320)); // 16시간 일한 주
  assert.equal(c.gross, 16 * 10320 + c.weekly);
  assert.equal(c.deducted, Math.floor(c.gross * 0.03 / 10) * 10 + Math.floor(Math.floor(c.gross * 0.03 / 10) * 10 * 0.1 / 10) * 10);
  assert.equal(oct.net, oct.gross - oct.deducted);
  const sep = monthSummary(shifts, [cafe, pub], "2026-09");
  assert.equal(sep.gross, 4 * 10320);
  const cmp = compare(oct, sep);
  assert.ok(cmp.gross > 100);
  assert.equal(typeof cmp.rate, "number");
  assert.equal(compare(oct, { gross: 0, net: 0, minutes: 0, rate: 0 }).gross, null);
});

test("달력 칸과 날짜별 합", () => {
  const cells = monthCells("2026-10");
  assert.equal(cells.length % 7, 0);
  assert.equal(cells[4], "2026-10-01"); // 2026-10-01은 목요일
  assert.equal(cells.filter(Boolean).length, 31);
  assert.equal(monthCells("2027-02").filter(Boolean).length, 28);
  const t = dayTotals([s("2026-10-05", "09:00", "12:00"), s("2026-10-05", "13:00", "14:00")], [cafe]);
  assert.deepEqual([t["2026-10-05"].minutes, t["2026-10-05"].pay, t["2026-10-05"].items.length], [240, 41280, 2]);
});

const daily = { id: "d", pay_kind: "daily", wage: 150000, tax_type: "insured" };

test("일당: 적은 금액 그대로, 시각은 선택", async () => {
  const { NO_TIME } = await import("../js/pay.js");
  const a = shiftPay({ start_time: NO_TIME, end_time: NO_TIME, break_min: 0 }, daily);
  assert.deepEqual([a.total, a.work, a.overtime, a.nightPay], [150000, 0, 0, 0]);
  const b = shiftPay({ start_time: "08:00", end_time: "17:00", break_min: 60, wage: 200000 }, daily);
  assert.deepEqual([b.total, b.work], [200000, 480]);
  assert.equal(weeklyAllowances([{ ...s("2026-10-05", "08:00", "20:00", "d") }], { ...daily, weekly: true }).length, 0);
});

test("일용직 세금: 15만 원 넘는 부분 2.7%, 1,000원 미만은 안 뗌, 고용보험 0.9%", async () => {
  const { dailyDeductions } = await import("../js/pay.js");
  // 20만 원: (5만 × 6% × 45%) = 1,350 → 소득세 1,350, 지방 130
  // 18만 원: 3만 × 2.7% = 810 → 1,000원 미만이라 0
  const r = dailyDeductions([200000, 180000, 150000], "insured");
  const by = Object.fromEntries(r.items.map((x) => [x.name.split(" ")[0], x.amount]));
  assert.equal(by["일용근로소득세"], 1350);
  assert.equal(by["지방소득세"], 130);
  assert.equal(by["고용보험"], 4770); // 53만 원 × 0.9%
});

test("직접 적은 달 급여: 계산 대신 쓰고, 세후를 비우면 세금 방식대로", () => {
  const shifts = [s("2026-08-03", "09:00", "13:00", "c")];
  const manual = [
    { place_id: "c", month: "2026-08", gross: 500000, net: 483500, memo: "명세서" },
    { place_id: "p", month: "2026-08", gross: 1000000, net: null },
  ];
  const aug = monthSummary(shifts, [cafe, pub], "2026-08", manual);
  const c = aug.byPlace.find((x) => x.place.id === "c"), p = aug.byPlace.find((x) => x.place.id === "p");
  assert.deepEqual([c.gross, c.net, c.deducted, !!c.manual, c.shifts], [500000, 483500, 16500, true, 1]);
  assert.equal(p.gross, 1000000);
  assert.ok(p.deducted > 0 && p.deductions.length === 6); // 4대보험 방식으로 계산
  assert.equal(aug.gross, 1500000);
  // 기록도 직접 적은 것도 없는 달은 비어 있음
  assert.equal(monthSummary(shifts, [cafe, pub], "2026-07", manual).byPlace.length, 0);
});

test("반복 근무: 매주 일 12~20, 수 17~22:30, 이미 있는 날은 건너뜀", async () => {
  const { weeklyPlan } = await import("../js/pay.js");
  const rows = [{ dow: 0, start_time: "12:00", end_time: "20:00", break_min: 0 }, { dow: 3, start_time: "17:00", end_time: "22:30", break_min: 0 }];
  const existing = [{ place_id: "c", work_date: "2026-11-04", start_time: "17:00" }, { place_id: "x", work_date: "2026-11-01", start_time: "12:00" }];
  const { add, skipped } = weeklyPlan(rows, "2026-11-01", "2026-11-30", existing, "c");
  // 11월 일요일 5번(1,8,15,22,29) + 수요일 4번(4,11,18,25) 중 4일은 이미 있음
  assert.deepEqual(add.map((s) => s.work_date), ["2026-11-01", "2026-11-08", "2026-11-11", "2026-11-15", "2026-11-18", "2026-11-22", "2026-11-25", "2026-11-29"]);
  assert.deepEqual(skipped, ["2026-11-04"]);
  assert.deepEqual([add[1].start_time, add[1].end_time, add[2].end_time], ["12:00", "20:00", "22:30"]);
  assert.equal(weeklyPlan(rows, "2026-11-30", "2026-11-01", [], "c").add.length, 0); // 거꾸로 된 기간
});
