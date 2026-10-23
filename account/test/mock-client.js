// 화면 확인용 가짜 Supabase 클라이언트 (메모리에만 저장). 실제 사이트에서는 쓰지 않습니다.
const me = "u1";
const db = {
  profiles: [
    { id: "u1", nickname: "메이로", email: "me@example.com", approved: true, created_at: "2026-09-01T00:00:00Z" },
    { id: "u2", nickname: "친구", email: "friend@example.com", approved: true, created_at: "2026-10-02T00:00:00Z" },
    { id: "u3", nickname: "새 회원", email: "new@example.com", approved: false, created_at: "2026-10-22T00:00:00Z" },
  ],
  user_roles: [{ user_id: "u1", role: "admin" }],
  feedback: [
    { id: "f1", user_id: null, nickname: "지나가던 사람", content: "메인 페이지 시계가 예뻐요!\n초 단위 말고 날짜도 크게 보면 좋겠어요.", page: "/", is_read: false, created_at: "2026-10-23T14:00:00Z" },
    { id: "f2", user_id: "u2", nickname: "친구", content: "MEIRONOTE에 글자 수 목표 기능이 있으면 좋겠어요.", page: "/note/", is_read: true, created_at: "2026-10-22T09:30:00Z" },
  ],
};
const log = (window.__ACCOUNT_LOG__ = []);
const asAdmin = !location.search.includes("member");
class Query {
  constructor(t) { this.t = t; this.f = []; this.op = "select"; this.one = false; }
  select() { return this; }
  eq(k, v) { this.f.push([k, v]); return this; }
  order() { return this; }
  update(p) { this.op = "update"; this.patch = p; return this; }
  delete() { this.op = "delete"; return this; }
  maybeSingle() { this.one = true; return this; }
  run() {
    const uid = asAdmin ? me : "u2";
    let rows = (db[this.t] ?? []).filter((r) => this.f.every(([k, v]) => String(r[k]) === String(v)));
    if (this.t === "profiles" && !asAdmin) rows = rows.filter((r) => r.id === uid);
    if (this.op === "update") { rows.forEach((r) => Object.assign(r, this.patch)); log.push(`update ${this.t} ${JSON.stringify(this.patch)}`); }
    if (this.op === "delete") { db[this.t] = db[this.t].filter((r) => !rows.includes(r)); log.push(`delete ${this.t} ${rows.length}`); }
    rows = structuredClone(rows);
    return { data: this.one ? rows[0] ?? null : rows, error: null };
  }
  then(a, b) { return Promise.resolve(this.run()).then(a, b); }
}
const user = () => ({ id: asAdmin ? me : "u2", email: asAdmin ? "me@example.com" : "friend@example.com", created_at: "2026-09-01T00:00:00Z", new_email: window.__NEW_EMAIL__ });
window.__ACCOUNT_DB__ = db;
window.__ACCOUNT_TEST_CLIENT__ = {
  from: (t) => new Query(t),
  rpc: async (fn, args) => {
    log.push(`rpc ${fn} ${JSON.stringify(args)}`);
    if (fn === "approve_user") db.profiles.find((p) => p.id === args._user_id).approved = args._approved;
    if (fn === "admin_delete_user") { db.profiles = db.profiles.filter((p) => p.id !== args._user_id); return { data: ["u3/a.jpg"], error: null }; }
    return { data: null, error: null };
  },
  functions: { invoke: async (name, { body }) => {
    log.push(`invoke ${name} ${JSON.stringify(body)}`);
    if (body.email === "taken@example.com") return { data: null, error: { context: { json: async () => ({ error: "이미 다른 계정이 쓰는 이메일이에요." }) } } };
    const p = db.profiles.find((x) => x.id === body.user_id);
    if (body.nickname) p.nickname = body.nickname;
    if (body.email) p.email = body.email;
    if (typeof body.approved === "boolean") p.approved = body.approved;
    if (body.is_admin === true) db.user_roles.push({ user_id: p.id, role: "admin" });
    if (body.is_admin === false) db.user_roles = db.user_roles.filter((r) => r.user_id !== p.id);
    return { data: { ok: true }, error: null };
  } },
  storage: { from: () => ({ remove: async (paths) => { log.push(`storage remove ${paths}`); return { error: null }; } }) },
  auth: {
    getSession: async () => ({ data: { session: location.hash.includes("/login") ? null : { user: user() } } }),
    getUser: async () => ({ data: { user: user() } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signInWithPassword: async ({ password }) => (password === "right-pw" ? { error: null } : { error: { message: "Invalid login credentials" } }),
    updateUser: async (attrs) => { log.push(`updateUser ${JSON.stringify(attrs)}`); if (attrs.email) window.__NEW_EMAIL__ = attrs.email; return { error: null }; },
    signOut: async () => ({ error: null }),
  },
};
