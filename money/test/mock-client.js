// 화면 확인용 가짜 Supabase 클라이언트 (메모리에만 저장). 실제 사이트에서는 쓰지 않습니다.
import { DEFAULT_CATEGORIES } from "../js/money.js";

const uid = "u1";
const rid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const cats = DEFAULT_CATEGORIES.map((c, i) => ({ ...c, id: `c${i}`, user_id: uid, created_at: now() }));
const cid = (name) => cats.find((c) => c.name === name).id;
const at = (s) => new Date(Date.parse(`${s}:00+09:00`)).toISOString(); // 한국 시각

const tx = (o) => ({ id: rid(), user_id: uid, kind: "expense", category_id: null, place: "", memo: "", tx_type: "", balance_after: null, source: "manual", import_key: null, pair_id: null, created_at: now(), ...o });
const db = {
  profiles: [{ id: uid, nickname: "메이로", approved: true }],
  money_accounts: [
    { id: "a-kakao", user_id: uid, name: "카카오뱅크", bank: "kakao", opening_balance: 0, sort: 0 },
    { id: "a-cash", user_id: uid, name: "현금", bank: "cash", opening_balance: 30000, sort: 1 },
    { id: "a-hana", user_id: uid, name: "하나 월급통장", bank: "hana", opening_balance: 120000, sort: 2 },
  ],
  money_categories: cats,
  // 고정: 용돈(매월 1일, 끝 없음), 월세(2026.10~2027.02, 매월 25일)
  money_recurring: [
    { id: "rec1", user_id: uid, name: "용돈", kind: "income", amount: 300000, account_id: "a-kakao", category_id: cid("용돈"), day: 1, start_month: "2026-10", end_month: null },
    { id: "rec2", user_id: uid, name: "월세", kind: "expense", amount: 400000, account_id: "a-kakao", category_id: cid("기타"), day: 25, start_month: "2026-10", end_month: "2027-02" },
  ],
  money_rules: [{ id: "r1", user_id: uid, place: "넷플릭스", kind: "expense", category_id: cid("구독") }],
  money_budgets: [
    { id: "b0", user_id: uid, category_id: null, amount: 600000 },
    { id: "b1", user_id: uid, category_id: cid("식비"), amount: 200000 },
    { id: "b2", user_id: uid, category_id: cid("카페"), amount: 40000 },
    { id: "b3", user_id: uid, category_id: cid("용돈"), amount: 300000 },
    { id: "b4", user_id: uid, category_id: cid("저축"), amount: 100000 },
  ],
  money_transactions: [
    // 직접 넣어 둔 것: 파일의 스타벅스와 합쳐져야 함
    tx({ account_id: "a-kakao", occurred_at: at("2026-10-01T10:40"), amount: -13400, category_id: cid("카페"), place: "스타벅스", memo: "친구랑" }),
    // 하나 통장에 들어온 4만 원: 파일의 '하나 월급통장' 자동이체와 이체 짝
    tx({ account_id: "a-hana", occurred_at: at("2026-10-01T10:48"), amount: 40000, kind: "income", source: "import", import_key: "h1", tx_type: "타행입금", place: "메이로" }),
    tx({ account_id: "a-cash", occurred_at: at("2026-10-05T12:30"), amount: -7000, category_id: cid("식비"), place: "학식" }),
    tx({ account_id: "a-cash", occurred_at: at("2026-10-12T18:10"), amount: -4500, category_id: cid("카페"), place: "메가커피" }),
    tx({ account_id: "a-kakao", occurred_at: at("2026-10-14T09:00"), amount: -1500, category_id: cid("교통"), place: "버스" }),
    tx({ account_id: "a-kakao", occurred_at: at("2026-10-15T19:20"), amount: -58000, category_id: cid("식비"), place: "고깃집" }),
    tx({ account_id: "a-kakao", occurred_at: at("2026-10-18T14:00"), amount: -32000, category_id: cid("카페"), place: "디저트카페" }),
    tx({ account_id: "a-kakao", occurred_at: at("2026-10-21T20:00"), amount: -45000, category_id: cid("문화"), place: "공연 예매" }),
    tx({ account_id: "a-kakao", occurred_at: at("2026-10-22T13:00"), amount: -15000, place: "온라인 결제" }),
    tx({ account_id: "a-kakao", occurred_at: at("2026-10-23T08:40"), amount: -1500, category_id: cid("교통"), place: "버스" }),
    tx({ account_id: "a-kakao", occurred_at: at("2026-10-19T11:00"), amount: -6000, place: "이디야" }),
    tx({ account_id: "a-kakao", occurred_at: at("2026-10-09T11:00"), amount: -5500, place: "이디야 " }),
    // 지난달
    tx({ account_id: "a-kakao", occurred_at: at("2026-09-10T12:00"), amount: -60000, category_id: cid("식비"), place: "식당" }),
    tx({ account_id: "a-kakao", occurred_at: at("2026-09-11T12:00"), amount: -20000, category_id: cid("카페"), place: "카페" }),
    tx({ account_id: "a-kakao", occurred_at: at("2026-09-01T07:00"), amount: 300000, kind: "income", category_id: cid("용돈"), place: "엄마" }),
  ],
};

class Query {
  constructor(table) { this.table = table; this.filters = []; this.op = "select"; this.one = null; this.sort = null; this.max = null; }
  select() { return this; }
  eq(k, v) { this.filters.push([k, v, "eq"]); return this; }
  gte(k, v) { this.filters.push([k, v, "gte"]); return this; }
  lt(k, v) { this.filters.push([k, v, "lt"]); return this; }
  not(k, op, v) { this.filters.push([k, v, "notnull"]); return this; }
  in(k, list) { this.filters.push([k, list, "in"]); return this; }
  order(k, o = {}) { this.sort = [k, o.ascending !== false]; return this; }
  limit(n) { this.max = n; return this; }
  insert(row) { this.op = "insert"; this.rows = Array.isArray(row) ? row : [row]; return this; }
  update(patch) { this.op = "update"; this.patch = patch; return this; }
  delete() { this.op = "delete"; return this; }
  maybeSingle() { this.one = "maybe"; return this; }
  single() { this.one = "single"; return this; }
  run() {
    const rows = db[this.table] ?? (db[this.table] = []);
    const match = (r) => this.filters.every(([k, v, op]) => op === "gte" ? String(r[k]) >= String(v) : op === "lt" ? String(r[k]) < String(v)
      : op === "notnull" ? r[k] != null : op === "in" ? v.includes(r[k]) : String(r[k]) === String(v));
    let out;
    if (this.op === "insert") {
      for (const r of this.rows) {
        if (r.import_key && rows.some((x) => x.import_key === r.import_key)) return { data: null, error: { message: "duplicate import_key" } };
      }
      out = this.rows.map((r) => ({ id: rid(), user_id: uid, created_at: now(), ...(this.table === "money_transactions" ? tx({}) : {}), ...r }));
      rows.push(...out);
    } else if (this.op === "update") { out = rows.filter(match); out.forEach((r) => Object.assign(r, this.patch)); }
    else if (this.op === "delete") { out = rows.filter(match); db[this.table] = rows.filter((r) => !match(r)); }
    else {
      out = rows.filter(match);
      if (this.sort) { const [k, asc] = this.sort; out = [...out].sort((a, b) => String(a[k]).localeCompare(String(b[k]), undefined, { numeric: true }) * (asc ? 1 : -1)); }
      if (this.max) out = out.slice(0, this.max);
    }
    out = structuredClone(out);
    if (this.one) return { data: out[0] ?? null, error: null };
    return { data: out, error: null };
  }
  then(res, rej) { return Promise.resolve(this.run()).then(res, rej); }
}

window.__MONEY_DB__ = db;
window.__MONEY_TEST_CLIENT__ = {
  from: (t) => new Query(t),
  auth: {
    getSession: async () => ({ data: { session: location.hash.includes("/login") ? null : { user: { id: uid, email: "me@example.com" } } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signInWithPassword: async () => ({ error: { message: "test" } }),
    signOut: async () => ({ error: null }),
  },
};
