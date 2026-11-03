// 투두메이트(Todo mate) 할 일 읽기 – 비공식 연결
// 투두메이트 웹 앱(todomate.net)과 같은 방식으로, 이 브라우저에서 Google Firebase에 바로 로그인하고 Firestore에서 할 일을 읽음.
// 비밀번호는 로그인할 때 한 번 Google로만 보내고 어디에도 저장하지 않음. 이 기기 브라우저에만 로그인 유지용 토큰을 둠.
// 투두메이트의 공식 기능이 아니라서, 투두메이트가 앱 구조를 바꾸면 동작하지 않을 수 있음.
// 데이터 구조(TodoItem·Goal 컬렉션, writerID·date 필드)는 3x-haust/todomate-api(MIT)를 참고함.

// 투두메이트 웹 앱이 누구에게나 내려보내는 공개 Firebase 설정 (비밀 값 아님)
const API_KEY = "AIzaSyCtSjt1LBEXmQnZdjD8DOPXBc5I1acm0Ew";
const PROJECT = "mate-914f3";
const STORE = "meiro-todomate";
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

const load = () => { try { return JSON.parse(localStorage.getItem(STORE)); } catch { return null; } };
const save = (v) => { try { v ? localStorage.setItem(STORE, JSON.stringify(v)) : localStorage.removeItem(STORE); } catch { /* 저장 못 함 */ } };
let id = null; // { token, uid, until }

export const isConnected = () => !!load()?.refreshToken;
export const disconnect = () => { save(null); id = null; };

/** 이메일·비밀번호로 한 번 로그인. 성공하면 이 기기에 로그인 유지용 토큰만 저장 */
export async function connect(email, password) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(loginMessage(j?.error?.message));
  save({ refreshToken: j.refreshToken, uid: j.localId });
  id = { token: j.idToken, uid: j.localId, until: Date.now() + Number(j.expiresIn) * 1000 };
}

function loginMessage(code = "") {
  if (/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND|INVALID_EMAIL/.test(code)) return "이메일이나 비밀번호가 맞지 않아요. (구글·애플·카카오로만 가입했다면 이메일 로그인이 안 될 수 있어요)";
  if (/TOO_MANY_ATTEMPTS/.test(code)) return "로그인 시도가 너무 많아요. 잠시 뒤 다시 해 주세요.";
  if (/USER_DISABLED/.test(code)) return "사용할 수 없는 계정이에요.";
  return "투두메이트에 로그인하지 못했어요.";
}

/** 짧게 쓰는 로그인 표(1시간)를 저장해 둔 토큰으로 새로 받음 */
async function token() {
  if (id && id.until - 60000 > Date.now()) return id;
  const s = load();
  if (!s?.refreshToken) throw new Error("투두메이트에 연결해 주세요.");
  const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: s.refreshToken }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 400) disconnect(); // 비밀번호를 바꿨거나 토큰이 만료됨 → 다시 연결해야 함
    throw new Error("투두메이트 연결이 끊겼어요. 다시 연결해 주세요.");
  }
  save({ refreshToken: j.refresh_token, uid: j.user_id });
  id = { token: j.id_token, uid: j.user_id, until: Date.now() + Number(j.expires_in) * 1000 };
  return id;
}

/* ---------- Firestore 값 ---------- */
const enc = (v) => (typeof v === "string" ? { stringValue: v } : Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v });
export function dec(v) {
  if (!v || typeof v !== "object") return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values ?? []).map(dec);
  if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, dec(x)]));
  return null;
}
const docOf = (d) => ({ _id: d.name?.split("/").pop(), ...Object.fromEntries(Object.entries(d.fields ?? {}).map(([k, x]) => [k, dec(x)])) });

async function query(collection, filters) {
  const t = await token();
  const where = filters.length === 1
    ? { fieldFilter: { field: { fieldPath: filters[0][0] }, op: "EQUAL", value: enc(filters[0][1]) } }
    : { compositeFilter: { op: "AND", filters: filters.map(([f, v]) => ({ fieldFilter: { field: { fieldPath: f }, op: "EQUAL", value: enc(v) } })) } };
  const r = await fetch(`${FS}:runQuery`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${t.token}` },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: collection }], where } }),
  });
  if (!r.ok) throw new Error("투두메이트 할 일을 불러오지 못했어요.");
  return (await r.json()).filter((x) => x.document).map((x) => docOf(x.document));
}

/** 투두메이트의 날짜 값: 그날 UTC 자정의 밀리초 */
export const todomateDate = (ymd) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10));

/** 색 값(정수 ARGB 또는 "#rrggbb")을 CSS 색으로 */
export function cssColor(c) {
  if (typeof c === "string" && /^#?[0-9a-f]{6,8}$/i.test(c)) return c.startsWith("#") ? c : `#${c}`;
  if (typeof c === "number") return `#${(c >>> 0).toString(16).padStart(8, "0").slice(2)}`;
  return null;
}

/** 그날 할 일: [{ id, content, done, goal: { name, color } }] (목표 순서 → 만든 순서) */
export async function todosOn(ymd) {
  const t = await token();
  const [todos, goals] = await Promise.all([
    query("TodoItem", [["writerID", t.uid], ["date", todomateDate(ymd)]]),
    query("Goal", [["userID", t.uid]]).catch(() => []),
  ]);
  const goalOf = new Map(goals.map((g) => [g.id ?? g._id, g]));
  return todos.map((x) => {
    const g = goalOf.get(x.goalID);
    return { id: x.id ?? x._id, content: x.content ?? "", done: !!x.isDone, createTime: x.createTime ?? 0,
      goal: g ? { name: g.name ?? g.title ?? g.content ?? "", color: cssColor(g.color), priority: g.priority ?? 0 } : null };
  }).sort((a, b) => (a.goal?.priority ?? 99) - (b.goal?.priority ?? 99) || a.createTime - b.createTime);
}
