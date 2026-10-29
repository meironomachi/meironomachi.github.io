// 화면 확인용 가짜 Supabase 클라이언트 (메모리에만 저장). 실제 사이트에서는 쓰지 않습니다.
const uid = "u1";
const rid = () => crypto.randomUUID();
const sh = (d, place, start, end, brk = 0, o = {}) => ({ id: rid(), user_id: uid, place_id: place, work_date: d, start_time: start, end_time: end, break_min: brk, wage: null, memo: "", ...o });
const empty = location.search.includes("empty");
const db = {
  profiles: [{ id: uid, nickname: "메이로", approved: true }],
  pay_places: empty ? [] : [
    { id: "cafe", user_id: uid, name: "동네 카페", color: "#0031b0", wage: 10320, tax_type: "biz33", weekly: true, extra: false, sort: 0, created_at: "1" },
    { id: "pub", user_id: uid, name: "주말 호프", color: "#e8590c", wage: 12000, tax_type: "insured", weekly: false, extra: true, night: true, sort: 1, created_at: "2" },
    { id: "tutor", user_id: uid, name: "과외", color: "#2f9e44", wage: 30000, tax_type: "none", weekly: false, extra: false, sort: 2, created_at: "3" },
    { id: "event", user_id: uid, name: "행사 스태프", color: "#9c36b5", pay_kind: "daily", wage: 150000, tax_type: "insured", weekly: false, extra: false, sort: 3, created_at: "4" },
  ],
  pay_months: empty ? [] : [{ id: "m1", user_id: uid, place_id: "cafe", month: "2026-08", gross: 480000, net: 464160, memo: "8월 명세서" }],
  pay_shifts: empty ? [] : [
    ...["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"].map((d) => sh(d, "cafe", "10:00", "15:30", 30)),
    sh("2026-10-10", "pub", "18:00", "02:00", 60), sh("2026-10-17", "pub", "18:00", "02:00", 60), sh("2026-10-24", "pub", "17:00", "03:00", 60, { memo: "축제" }),
    sh("2026-10-08", "tutor", "19:00", "21:00"), sh("2026-10-15", "tutor", "19:00", "21:00"), sh("2026-10-22", "tutor", "19:00", "21:00"),
    ...["2026-09-07", "2026-09-08", "2026-09-14", "2026-09-15", "2026-09-21", "2026-09-22"].map((d) => sh(d, "cafe", "10:00", "15:30", 30)),
    sh("2026-09-12", "pub", "18:00", "01:00", 60),
    sh("2026-10-03", "event", "00:00", "00:00", 0, { wage: 200000, memo: "축제" }), sh("2026-10-04", "event", "00:00", "00:00", 0),
  ],
};
class Query {
  constructor(t) { this.t = t; this.f = []; this.op = "select"; this.one = false; this.sorts = []; }
  select() { return this; }
  eq(k, v) { this.f.push([k, v]); return this; }
  order(k) { this.sorts.push(k); return this; }
  insert(r) { this.op = "insert"; this.rows = Array.isArray(r) ? r : [r]; return this; }
  update(p) { this.op = "update"; this.patch = p; return this; }
  delete() { this.op = "delete"; return this; }
  maybeSingle() { this.one = true; return this; }
  run() {
    const all = db[this.t] ?? (db[this.t] = []);
    const m = (r) => this.f.every(([k, v]) => String(r[k]) === String(v));
    let out;
    if (this.op === "insert") { out = this.rows.map((r) => ({ id: rid(), user_id: uid, created_at: String(Date.now()), ...r })); all.push(...out); }
    else if (this.op === "update") { out = all.filter(m); out.forEach((r) => Object.assign(r, this.patch)); }
    else if (this.op === "delete") { out = all.filter(m); db[this.t] = all.filter((r) => !m(r)); if (this.t === "pay_places") db.pay_shifts = db.pay_shifts.filter((s) => !out.some((p) => p.id === s.place_id)); }
    else { out = all.filter(m); for (const k of [...this.sorts].reverse()) out = [...out].sort((a, b) => String(a[k]).localeCompare(String(b[k]))); }
    out = structuredClone(out);
    return { data: this.one ? out[0] ?? null : out, error: null };
  }
  then(a, b) { return Promise.resolve(this.run()).then(a, b); }
}
window.__PAY_DB__ = db;
window.__PAY_TEST_CLIENT__ = {
  from: (t) => new Query(t),
  auth: {
    getSession: async () => ({ data: { session: location.hash.includes("/login") ? null : { user: { id: uid, email: "me@example.com" } } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signInWithPassword: async () => ({ error: { message: "test" } }),
    signOut: async () => ({ error: null }),
  },
};
