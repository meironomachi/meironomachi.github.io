// 화면 확인용 가짜 Supabase 클라이언트 (메모리에만 저장). 실제 사이트에서는 쓰지 않습니다.
const uid = "u1";
const rid = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();
const fakeCover = (seed, a, b) => "data:image/svg+xml," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 174"><rect width="120" height="174" fill="${a}"/><rect x="14" y="30" width="92" height="3" fill="${b}"/><text x="14" y="70" font-size="15" font-family="sans-serif" fill="${b}">${seed}</text><circle cx="86" cy="130" r="22" fill="${b}" opacity=".5"/></svg>`);

const book = (o) => ({ id: rid(), user_id: uid, authors: [], publisher: "", isbn: "", cover_url: "", status: "done", format: "ebook", progress_unit: "percent", progress: 100,
  total_pages: null, started_on: null, finished_on: null, rating: null, one_line: "", q_thoughts: "", q_further: "", q_learned: "", review: "", genre: "",
  created_at: now(), updated_at: "2026-10-01T00:00:00Z", ...o });
const db = {
  profiles: [{ id: uid, nickname: "메이로", approved: true }],
  books: [
    book({ id: "b1", title: "한국 가족주의의 기원", authors: ["김동춘"], publisher: "피어나", isbn: "111", cover_url: fakeCover("가족", "#2f4858", "#f6d55c"), finished_on: "2026-10-23", rating: 4, genre: "사회",
      one_line: "가족은 사랑의 단위이기 전에 생존의 단위였다.", q_thoughts: "가족주의를 개인의 성향이 아니라 국가와 사회가 만든 구조로 보게 됐다.\n남북한이 같은 뿌리에서 다르게 갈라진 지점이 흥미로웠다.",
      q_further: "지금 세대의 가족주의는 어떤 모습으로 바뀌고 있을까?", q_learned: "", review: "<!--rich--><div>읽는 내내 <b>우리 집</b>을 떠올렸다. <span style=\"background-color:rgba(255, 212, 0, 0.45)\">공식관계 이면</span>이라는 말이 오래 남는다.</div>" }),
    book({ id: "b2", title: "코스모스", authors: ["칼 세이건"], publisher: "사이언스북스", cover_url: fakeCover("COSMOS", "#14213d", "#fca311"), finished_on: "2026-08-14", rating: 5, genre: "과학" }),
    book({ id: "b3", title: "아주 작은 습관의 힘", authors: ["제임스 클리어"], cover_url: "", finished_on: "2026-05-02", rating: 3 }),
    book({ id: "b4", title: "사피엔스", authors: ["유발 하라리"], cover_url: fakeCover("Sapiens", "#e9d8a6", "#9b2226"), finished_on: "2025-12-20", rating: 4 }),
    book({ id: "b5", title: "총, 균, 쇠", authors: ["재레드 다이아몬드"], status: "reading", progress: 42, finished_on: null, started_on: "2026-10-10", updated_at: "2026-10-22T00:00:00Z", cover_url: fakeCover("GGS", "#6d597a", "#eaac8b") }),
    book({ id: "b6", title: "이기적 유전자", authors: ["리처드 도킨스"], status: "want", progress: 0, finished_on: null }),
  ],
  highlights: [
    { id: "h1", user_id: uid, book_id: "b1", text: "가족주의는 남한뿐만 아니라 북한과 해외동포 사회에서도 나타난다.", page: 24, highlighted_at: "2026-10-23T09:16:00Z", color: "yellow", note: "", created_at: now() },
    { id: "h2", user_id: uid, book_id: "b1", text: "즉, 북한은 유교적 심성과 가족주의를 국가의 지배논리로 변화시켰다면, 남한은 공식관계 이면에서 그러한 공식관계를 유지, 재생산하기 위한 기제로 활용하고 있다.", page: 24, highlighted_at: "2026-10-23T09:16:00Z", color: "yellow", note: "", created_at: now() },
    { id: "h3", user_id: uid, book_id: "b1", text: "가족은 국가가 책임지지 않는 영역을 떠맡아 왔다.", page: 57, highlighted_at: "2026-10-23T10:02:00Z", color: "sky", note: "", created_at: now() },
  ],
};

class Query {
  constructor(table) { this.table = table; this.filters = []; this.op = "select"; this.one = null; this.sort = null; }
  select() { return this; }
  eq(k, v) { this.filters.push([k, v]); return this; }
  order(k, o = {}) { this.sort = [k, o.ascending !== false, o.nullsFirst]; return this; }
  insert(row) { this.op = "insert"; this.rows = Array.isArray(row) ? row : [row]; return this; }
  update(patch) { this.op = "update"; this.patch = patch; return this; }
  delete() { this.op = "delete"; return this; }
  maybeSingle() { this.one = "maybe"; return this; }
  single() { this.one = "single"; return this; }
  run() {
    const rows = db[this.table];
    const match = (r) => this.filters.every(([k, v]) => String(r[k]) === String(v));
    let out;
    if (this.op === "insert") { out = this.rows.map((r) => ({ id: rid(), user_id: uid, created_at: now(), updated_at: now(), ...(this.table === "books" ? book({}) : {}), ...r })); rows.push(...out); }
    else if (this.op === "update") { out = rows.filter(match); out.forEach((r) => Object.assign(r, this.patch)); }
    else if (this.op === "delete") { out = rows.filter(match); db[this.table] = rows.filter((r) => !match(r)); }
    else {
      out = rows.filter(match);
      if (this.sort) {
        const [k, asc] = this.sort;
        out = [...out].sort((a, b) => (a[k] == null) - (b[k] == null) || String(a[k]).localeCompare(String(b[k]), undefined, { numeric: true }) * (asc ? 1 : -1));
      }
    }
    out = structuredClone(out);
    if (this.one) return { data: out[0] ?? null, error: this.one === "single" && !out[0] ? { message: "none" } : null };
    return { data: out, error: null };
  }
  then(res, rej) { return Promise.resolve(this.run()).then(res, rej); }
}

const signedIn = !location.hash.includes("/login");
window.__LIBRARY_TEST_CLIENT__ = {
  from: (t) => new Query(t),
  functions: {
    invoke: async (name, { body }) => ({
      data: { documents: [
        { title: `${body.query}의 역사`, authors: ["홍길동"], publisher: "메이로출판", isbn: "999", thumbnail: fakeCover("History", "#264653", "#e9c46a"), datetime: "2024-03-01T00:00:00.000+09:00" },
        { title: `처음 읽는 ${body.query}`, authors: ["김철수", "이영희"], publisher: "도서관", isbn: "998", thumbnail: "", datetime: "2021-01-01T00:00:00.000+09:00" },
      ] }, error: null,
    }),
  },
  auth: {
    getSession: async () => ({ data: { session: signedIn ? { user: { id: uid, email: "me@example.com" } } : null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signInWithPassword: async () => ({ error: { message: "test" } }),
    signUp: async () => ({ data: {}, error: null }),
    signOut: async () => ({ error: null }),
  },
};
