// MEIROPAY 계산 규칙: 근무 시간, 수당, 세금·4대보험, 한 달 합계
// 금액은 모두 원 단위 정수. 세금·보험료는 10원 미만을 버림(실무와 같음).

export const MIN_WAGE_2026 = 10320; // 2026년 최저시급

// 2026년 근로자 부담 요율 (요율이 바뀌면 여기만 고치면 됨)
export const RATES = {
  year: 2026,
  pension: 0.0475, // 국민연금 9.5%의 절반
  pensionCap: 6370000, // 국민연금 기준소득월액 상한
  health: 0.03595, // 건강보험 7.19%의 절반
  care: 0.1314, // 장기요양보험: 건강보험료의 13.14%
  employment: 0.009, // 고용보험
  biz: 0.03, // 사업소득 원천징수 3% (+ 지방소득세 0.3%)
};
export const TAX_TYPES = [
  { id: "biz33", name: "3.3%", long: "사업소득 3.3% (소득세 3% + 지방소득세 0.3%)" },
  { id: "insured", name: "4대보험", long: "4대보험 + 근로소득세 (간이세액 계산)" },
  { id: "none", name: "세금 없음", long: "떼는 것 없음" },
];
export const taxName = (id) => TAX_TYPES.find((t) => t.id === id)?.name ?? "";

const floor10 = (n) => Math.floor(n / 10) * 10;
export const won = (n) => `${Math.round(n).toLocaleString("ko-KR")}원`;
export const hoursText = (min) => {
  const h = Math.floor(min / 60), m = min % 60;
  return m ? (h ? `${h}시간 ${m}분` : `${m}분`) : `${h}시간`;
};
export const hoursShort = (min) => `${Math.round(min / 6) / 10}h`;

/* ---------- 날짜 ---------- */
export const isDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const isMonth = (s) => typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const utc = (day) => new Date(`${day}T00:00:00Z`);
const ymd = (d) => d.toISOString().slice(0, 10);
export const addDays = (day, n) => { const d = utc(day); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
export const dow = (day) => utc(day).getUTCDay(); // 0=일
export function shiftMonth(month, n) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
/** 달력 칸: 일요일부터 시작, 앞뒤 빈칸은 null */
export function monthCells(month) {
  const first = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = Array.from({ length: dow(first) }, () => null);
  for (let d = 1; d <= count; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}
/** 그 날이 속한 주의 월요일 (주휴수당은 월~일 한 주로 셈) */
export const weekStart = (day) => addDays(day, -((dow(day) + 6) % 7));

/* ---------- 하루 근무 ---------- */
export const toMin = (hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + m; };
const overlap = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));

/**
 * 근무 한 번의 시간 계산. 끝 시각이 시작보다 이르면 다음 날까지 일한 것.
 * 휴게시간은 일한 시간에서 빼되, 야간(22~06시)이 아닌 시간에서 먼저 뺌.
 */
export function shiftMinutes(s) {
  const start = toMin(s.start_time);
  let end = toMin(s.end_time);
  if (end <= start) end += 24 * 60;
  const span = end - start;
  const brk = Math.min(Math.max(0, Number(s.break_min) || 0), span);
  // 야간: 전날 22시~06시, 그날 22시~다음 날 06시
  let night = overlap(start, end, -120, 360) + overlap(start, end, 1320, 1800) + overlap(start, end, 2760, 3240);
  const day = span - night;
  night = Math.max(0, night - Math.max(0, brk - day));
  const work = span - brk;
  return { work, night: Math.min(night, work) };
}

/**
 * 근무 한 번의 돈. place.extra(5인 이상 사업장)이면 연장(하루 8시간 넘는 부분)·야간에 시급의 0.5배씩 더 줌.
 */
export function shiftPay(s, place) {
  const wage = Number(s.wage) || Number(place?.wage) || 0;
  const { work, night } = shiftMinutes(s);
  const base = Math.round(work / 60 * wage);
  const overtime = place?.extra ? Math.round(Math.max(0, work - 480) / 60 * wage * 0.5) : 0;
  const nightPay = place?.extra ? Math.round(night / 60 * wage * 0.5) : 0;
  return { wage, work, night, base, overtime, nightPay, total: base + overtime + nightPay };
}

/**
 * 주휴수당: 한 주(월~일)에 15시간 이상 일하면 (주 근무시간 ÷ 40 × 8시간, 최대 8시간) × 평균 시급.
 * 그 주의 일요일이 속한 달에 들어감. 같은 일하는 곳끼리만 셈.
 */
export function weeklyAllowances(shifts, place) {
  if (!place?.weekly) return [];
  const weeks = new Map();
  for (const s of shifts.filter((x) => x.place_id === place.id)) {
    const k = weekStart(s.work_date);
    const w = weeks.get(k) ?? { min: 0, pay: 0 };
    const p = shiftPay(s, place);
    w.min += p.work; w.pay += p.base;
    weeks.set(k, w);
  }
  return [...weeks].filter(([, w]) => w.min >= 15 * 60).map(([monday, w]) => {
    const avgWage = w.pay / (w.min / 60);
    const hours = Math.min(w.min, 40 * 60) / 60 / 40 * 8;
    return { monday, sunday: addDays(monday, 6), minutes: w.min, amount: Math.round(hours * avgWage) };
  });
}

/* ---------- 세금·보험료 ---------- */
/** 근로소득세 (간이세액표를 만드는 공식으로 계산한 근사치, 공제대상 가족 본인 1명) */
export function incomeTaxMonthly(monthly, pensionMonthly = 0) {
  if (monthly < 1060000) return 0; // 간이세액표: 월 106만 원 미만은 0원
  const a = monthly * 12;
  const deduct = a <= 5e6 ? a * 0.7 : a <= 15e6 ? 3.5e6 + (a - 5e6) * 0.4 : a <= 45e6 ? 7.5e6 + (a - 15e6) * 0.15 : a <= 1e8 ? 12e6 + (a - 45e6) * 0.05 : 14.75e6 + (a - 1e8) * 0.02;
  const special = a <= 30e6 ? 3.1e6 + a * 0.04 : a <= 45e6 ? 3.1e6 + a * 0.04 - (a - 30e6) * 0.05 : a <= 70e6 ? 3.1e6 + a * 0.015 : 3.1e6 + a * 0.005;
  const base = Math.max(0, a - deduct - 1.5e6 - pensionMonthly * 12 - special);
  const brackets = [[14e6, 0.06, 0], [50e6, 0.15, 0.84e6], [88e6, 0.24, 6.24e6], [150e6, 0.35, 15.36e6], [300e6, 0.38, 37.06e6], [500e6, 0.4, 94.06e6], [1e9, 0.42, 174.06e6], [Infinity, 0.45, 384.06e6]];
  let lo = 0, calc = 0;
  for (const [hi, rate, add] of brackets) { if (base <= hi) { calc = add + (base - lo) * rate; break; } lo = hi; }
  const credit = calc <= 1.3e6 ? calc * 0.55 : 715000 + (calc - 1.3e6) * 0.3;
  const limit = a <= 33e6 ? 740000 : a <= 70e6 ? Math.max(740000 - (a - 33e6) * 0.008, 660000) : Math.max(660000 - (a - 70e6) * 0.5, 500000);
  return floor10(Math.max(0, calc - Math.min(credit, limit)) / 12);
}

/** 한 달 받은 돈(세전)에서 떼는 것 */
export function deductions(gross, taxType, rates = RATES) {
  const items = [];
  if (taxType === "biz33") {
    const income = floor10(gross * rates.biz);
    items.push({ name: "소득세 (3%)", amount: income }, { name: "지방소득세 (0.3%)", amount: floor10(income * 0.1) });
  } else if (taxType === "insured") {
    const pension = floor10(Math.min(gross, rates.pensionCap) * rates.pension);
    const health = floor10(gross * rates.health);
    const care = floor10(health * rates.care);
    const employment = floor10(gross * rates.employment);
    const income = incomeTaxMonthly(gross, pension);
    items.push(
      { name: `국민연금 (${+(rates.pension * 100).toFixed(3)}%)`, amount: pension },
      { name: `건강보험 (${+(rates.health * 100).toFixed(3)}%)`, amount: health },
      { name: `장기요양보험 (건강보험료의 ${+(rates.care * 100).toFixed(2)}%)`, amount: care },
      { name: `고용보험 (${+(rates.employment * 100).toFixed(1)}%)`, amount: employment },
      { name: "근로소득세 (간이세액 근사치)", amount: income },
      { name: "지방소득세 (소득세의 10%)", amount: floor10(income * 0.1) },
    );
  }
  return { items, total: items.reduce((s, x) => s + x.amount, 0) };
}

/* ---------- 한 달 합계 ---------- */
/** month의 근무를 일하는 곳별로 모아 세전·공제·세후 계산. shifts는 앞뒤 주까지 넉넉히 넘겨야 주휴수당이 맞음 */
export function monthSummary(shifts, places, month) {
  const inMonth = (d) => d.startsWith(`${month}-`);
  const byPlace = places.map((place) => {
    const mine = shifts.filter((s) => s.place_id === place.id && inMonth(s.work_date));
    const pays = mine.map((s) => shiftPay(s, place));
    const weekly = weeklyAllowances(shifts, place).filter((w) => inMonth(w.sunday));
    const sum = (k) => pays.reduce((t, p) => t + p[k], 0);
    const gross = sum("total") + weekly.reduce((t, w) => t + w.amount, 0);
    const ded = deductions(gross, place.tax_type);
    return {
      place, days: new Set(mine.map((s) => s.work_date)).size, shifts: mine.length,
      minutes: sum("work"), night: sum("night"), base: sum("base"), overtime: sum("overtime"), nightPay: sum("nightPay"),
      weekly: weekly.reduce((t, w) => t + w.amount, 0), weeks: weekly,
      gross, deductions: ded.items, deducted: ded.total, net: gross - ded.total,
    };
  }).filter((x) => x.shifts || x.weekly);
  const total = (k) => byPlace.reduce((t, x) => t + x[k], 0);
  const gross = total("gross"), deducted = total("deducted");
  return { month, byPlace, minutes: total("minutes"), gross, deducted, net: gross - deducted, rate: gross ? deducted / gross * 100 : 0 };
}

/** 전월 대비: 금액은 %, 공제율은 %p */
export function compare(cur, prev) {
  const pct = (a, b) => (b ? Math.round((a - b) / b * 1000) / 10 : null);
  return {
    gross: pct(cur.gross, prev.gross),
    net: pct(cur.net, prev.net),
    hours: pct(cur.minutes, prev.minutes),
    rate: prev.gross && cur.gross ? Math.round((cur.rate - prev.rate) * 10) / 10 : null,
  };
}

/** 날짜별 합 (달력 칸에 표시) */
export function dayTotals(shifts, places) {
  const byId = new Map(places.map((p) => [p.id, p]));
  const out = {};
  for (const s of shifts) {
    const p = byId.get(s.place_id);
    if (!p) continue;
    const r = shiftPay(s, p);
    const d = (out[s.work_date] ??= { minutes: 0, pay: 0, items: [] });
    d.minutes += r.work; d.pay += r.total;
    d.items.push({ shift: s, place: p, ...r });
  }
  return out;
}
