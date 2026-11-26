// 로그인 없이 화면을 띄워 본다. 가짜 자료를 넣고 크로미움으로 그려서 글과 그림을 남긴다.
//
//   python3 -m http.server 8080 &          (meironomachi.github.io 안에서)
//   node money/tools/preview.mjs /debts
//   node money/tools/preview.mjs / --shot out.png
//
// app.js 의 window.__MONEY_TEST_CLIENT__ 훅으로 Supabase 자리를 바꿔 끼운다.
// 실제 자료는 건드리지 않는다.
// playwright 는 이 저장소에 없다. 전역에 깔린 것을 쓴다 (없으면 npm i -g playwright)
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const route = process.argv[2] ?? "/";
const shotAt = process.argv.indexOf("--shot");
const shot = shotAt > 0 ? process.argv[shotAt + 1] : null;
const port = process.env.PORT ?? "8080";

const day = (d, amount, place, tx_type = "") =>
  ({ id: `${d}-${place}`, occurred_at: `${d}T09:00:00+09:00`, amount, place, tx_type, planned: false,
     kind: amount < 0 ? "expense" : "income", category_id: null, account_id: "a1" });

// 부채가 섞인 한 해치 거래
const TXS = [
  ...["2025-09", "2025-10", "2025-11", "2025-12", "2026-01"]
    .map((m) => day(`${m}-25`, -150000, "한국장학재단 학자금대출", "자동이체")),
  day("2025-03-02", 9000000, "국민은행 전세자금대출 실행", "입금"),
  ...["2025-10", "2025-11", "2025-12"].map((m) => day(`${m}-15`, -200000, "엄마", "이체")),
  day("2026-01-10", -4500, "스타벅스", "체크카드"),
  day("2026-01-05", 2400000, "급여", "입금"),
];

const TABLES = {
  profiles: [{ id: "u1", nickname: "미리보기", approved: true }],
  money_transactions: TXS,
  // 하나는 이미 등록해 둔다 (이번 달 화면의 '갚아야 할 빚' 칸을 보려고).
  // match 를 걸어 두었으므로 상환은 위 거래에서 저절로 붙는다
  money_debts: [{ id: "d1", name: "학자금대출", lender: "한국장학재단", principal: 3000000,
                  match: "한국장학재단", due_on: "2031-03-01", rate: 1.7, closed: false, sort: 0, memo: "" }],
  money_debt_payments: [],
  money_accounts: [{ id: "a1", name: "카카오뱅크", kind: "bank", opening_balance: 0, sort: 0 }],
  money_categories: [{ id: "c1", name: "식비", kind: "expense", color: "#e8590c", sort: 0 }],
  money_rules: [],
  money_budgets: [{ id: "b1", category_id: null, month: null, amount: 800000 }],
  money_recurring: [],
};

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 900, height: 1400 }, deviceScaleFactor: 2 });
const errs = [];
p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
p.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });

await p.addInitScript(`
  window.__TABLES = ${JSON.stringify(TABLES)};
  const rows = (t) => window.__TABLES[t] ?? [];
  function builder(t) {
    const o = {
      select: () => o, order: () => o, or: () => o, not: () => o, gte: () => o, lt: () => o,
      eq: () => o, limit: () => o, in: () => o, is: () => o, ilike: () => o,
      update: () => o, delete: () => o,
      range: (a) => Promise.resolve({ data: a === 0 ? rows(t) : [], error: null }),
      insert: () => Promise.resolve({ data: null, error: null }),
      maybeSingle: () => Promise.resolve({ data: rows(t)[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: rows(t)[0] ?? null, error: null }),
      then: (res, rej) => Promise.resolve({ data: rows(t), error: null }).then(res, rej),
    };
    return o;
  }
  window.__MONEY_TEST_CLIENT__ = {
    from: builder,
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "u1", email: "preview@example.com" } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({}),
    },
  };
`);

await p.goto(`http://localhost:${port}/money/#${route}`, { waitUntil: "networkidle" });
await p.waitForTimeout(2000);

const main = await p.$("main");
console.log((await (main ?? p).innerText("body").catch(() => p.innerText("body")))
  .split("\n").filter(Boolean).slice(0, 60).join("\n"));
if (shot) { await p.screenshot({ path: shot, fullPage: true }); console.log(`\n그림: ${shot}`); }
console.log(errs.length ? `\n에러:\n  ${errs.join("\n  ")}` : "\nJS 에러 없음");
await b.close();
process.exit(errs.length ? 1 : 0);
