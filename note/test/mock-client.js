// 화면 확인용 가짜 Supabase 클라이언트 (메모리에만 저장). 실제 사이트에서는 쓰지 않습니다.
const uid = "u1";
const rid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const R = "<!--rich-->";
const post = (o) => ({ id: rid(), user_id: uid, folder_id: null, title: "", purpose: "", content: "", photos: [], status: "published",
  published_at: "2026-10-05T03:00:00Z", created_at: now(), updated_at: "2026-10-05T03:00:00Z", ...o });
const db = {
  profiles: [{ id: uid, nickname: "메이로", approved: true }],
  labels: [
    { id: "m1", user_id: uid, kind: "mood", name: "차분", color: "#1c7ed6", created_at: "1" },
    { id: "m2", user_id: uid, kind: "mood", name: "뿌듯", color: "#f08c00", created_at: "2" },
  ],
  writing_folders: [
    { id: "f1", user_id: uid, name: "에세이", color: "#0031b0", sort: 0, created_at: "1" },
    { id: "f2", user_id: uid, name: "과제", color: "#2f9e44", sort: 1, created_at: "2" },
  ],
  writing_posts: [
    post({ id: "p1", folder_id: "f1", written_on: "2026-10-03", title: "가을이 오는 소리", purpose: "에세이 공모전 초안",
      content: `${R}<div>아침 공기가 달라졌다. <b>창문을 열자</b> 차가운 바람이 들어왔다.</div><div>오늘은 <span style="background-color:rgba(255, 212, 0, 0.45)">천천히 걷기로</span> 했다.</div>` }),
    post({ id: "p2", folder_id: "f2", written_on: "2026-10-12", title: "생명과학 보고서 초안", purpose: "생명과학의 세계 3주차 과제 제출용", content: "세포는 생명의 기본 단위이다. 세포막은 인지질 이중층으로 이루어져 있다.\n물질 수송에는 능동 수송과 수동 수송이 있다." }),
    post({ id: "p3", folder_id: "f1", written_on: "2026-10-20", title: "작은 습관", content: "매일 한 문단씩 쓰기로 했다. 쓰다 보면 생각이 정리된다.", updated_at: "2026-10-21T03:00:00Z" }),
    post({ id: "p4", folder_id: null, written_on: "2026-09-28", title: "지난달 메모", content: "구월의 마지막 주." }),
    post({ id: "p5", folder_id: "f1", written_on: "2026-10-23", title: "쓰다 만 글", status: "draft", published_at: null, content: "아직 다 쓰지 못한 문장.", updated_at: "2026-10-23T05:00:00Z" }),
  ],
  writing_versions: [
    { id: "v1", user_id: uid, post_id: "p3", kind: "publish", fields: { title: "작은 습관", content: "매일 한 문단씩 쓰기로 했다.", written_on: "2026-10-20", folder_id: "f1", moods: [], photos: [] }, created_at: "2026-10-20T03:00:00Z", updated_at: "2026-10-20T03:00:00Z" },
    { id: "v2", user_id: uid, post_id: "p3", kind: "publish", fields: { title: "작은 습관", content: "매일 한 문단씩 쓰기로 했다. 쓰다 보면 생각이 정리된다.", written_on: "2026-10-20", folder_id: "f1", moods: [{ label_id: "m2", score: 85 }], photos: [] }, created_at: "2026-10-21T03:00:00Z", updated_at: "2026-10-21T03:00:00Z" },
    { id: "v3", user_id: uid, post_id: "p3", kind: "auto", fields: { title: "작은 습관 (고치는 중)", content: "매일 한 문단씩 쓰기로 했다. 쓰다 보면 생각이 정리된다. 오늘은 두 문단을 썼다.", written_on: "2026-10-20", folder_id: "f1", moods: [{ label_id: "m2", score: 85 }], photos: [] }, created_at: "2026-10-22T03:00:00Z", updated_at: "2026-10-22T03:10:00Z" },
    { id: "v4", user_id: uid, post_id: "p5", kind: "manual", fields: { title: "쓰다 만 글", content: "아직 다 쓰지 못한 문장.", written_on: "2026-10-23", folder_id: "f1", moods: [], photos: [] }, created_at: "2026-10-23T05:00:00Z", updated_at: "2026-10-23T05:00:00Z" },
  ],
  writing_comments: [{ id: "c1", user_id: uid, post_id: "p1", content: "다시 읽어도 좋다", created_at: "2026-10-04T12:00:00Z" }],
};

class Query {
  constructor(table) { this.table = table; this.filters = []; this.op = "select"; this.one = null; this.sorts = []; }
  select() { return this; }
  eq(k, v) { this.filters.push((r) => String(r[k]) === String(v)); return this; }
  in(k, list) { this.filters.push((r) => list.includes(r[k])); return this; }
  order(k, o = {}) { this.sorts.push([k, o.ascending !== false]); return this; }
  insert(row) { this.op = "insert"; this.rows = Array.isArray(row) ? row : [row]; return this; }
  update(patch) { this.op = "update"; this.patch = patch; return this; }
  delete() { this.op = "delete"; return this; }
  maybeSingle() { this.one = true; return this; }
  single() { this.one = true; return this; }
  run() {
    const rows = db[this.table] ?? (db[this.table] = []);
    const match = (r) => this.filters.every((f) => f(r));
    let out;
    if (this.op === "insert") {
      out = this.rows.map((r) => ({ id: rid(), user_id: uid, created_at: now(), updated_at: now(), ...r }));
      rows.push(...out);
      window.__NOTE_LOG__.push(`insert ${this.table} ${out.map((r) => r.kind ?? r.status ?? "").join(",")}`);
    } else if (this.op === "update") { out = rows.filter(match); out.forEach((r) => Object.assign(r, this.patch)); window.__NOTE_LOG__.push(`update ${this.table} ${out.length}`); }
    else if (this.op === "delete") {
      out = rows.filter(match); db[this.table] = rows.filter((r) => !match(r));
      if (this.table === "writing_posts") for (const t of ["writing_versions", "writing_comments"]) db[t] = db[t].filter((r) => !out.some((p) => p.id === r.post_id));
      if (this.table === "writing_folders") db.writing_posts.forEach((p) => { if (out.some((f) => f.id === p.folder_id)) p.folder_id = null; });
    } else {
      out = rows.filter(match);
      for (const [k, asc] of [...this.sorts].reverse()) out = [...out].sort((a, b) => String(a[k]).localeCompare(String(b[k]), undefined, { numeric: true }) * (asc ? 1 : -1));
    }
    out = structuredClone(out);
    return this.one ? { data: out[0] ?? null, error: null } : { data: out, error: null };
  }
  then(res, rej) { return Promise.resolve(this.run()).then(res, rej); }
}

window.__NOTE_DB__ = db;
window.__NOTE_LOG__ = [];
window.__NOTE_TEST_CLIENT__ = {
  from: (t) => new Query(t),
  storage: { from: () => ({
    createSignedUrls: async (paths) => ({ data: paths.map((p) => ({ path: p, signedUrl: "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#9bb0e8"/></svg>') })) }),
    upload: async () => ({ error: null }),
    remove: async () => ({ error: null }),
  }) },
  auth: {
    getSession: async () => ({ data: { session: location.hash.includes("/login") ? null : { user: { id: uid, email: "me@example.com" } } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signInWithPassword: async () => ({ error: { message: "test" } }),
    signOut: async () => ({ error: null }),
  },
};
