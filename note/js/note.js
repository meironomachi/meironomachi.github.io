// MEIRONOTE 규칙: 글자·단어 수, 자동 저장과 임시저장, 검색, 월간 리포트
export const KIND_NAME = { auto: "자동 저장", manual: "임시저장", publish: "올림" };

export const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : "#0031B0");

/* ---------- 날짜 (한국 시간) ---------- */
export const kstDay = (ms = Date.now()) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
export const isDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
export const isMonth = (s) => typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
export function shiftMonth(month, n) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
export const daysInMonth = (month) => { const [y, m] = month.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

/* ---------- 서식 있는 본문 (일기장과 같은 방식) ---------- */
export const RICH_MARK = "<!--rich-->";
export const isRich = (content) => typeof content === "string" && content.startsWith(RICH_MARK);
const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
/** 검색, 미리보기, 글자 수, 빈 글 확인용 글자만 뽑기 */
export function plainText(content) {
  if (!isRich(content)) return content ?? "";
  return content.slice(RICH_MARK.length)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m])
    .replace(/\n+$/, "");
}

/** 글자 수(공백 포함, 줄바꿈은 빼고), 공백 뺀 글자 수, 단어 수(띄어쓰기 기준) */
export function textStats(content) {
  const text = plainText(content);
  const noBreak = text.replace(/[\r\n]/g, "");
  return {
    chars: [...noBreak].length,
    noSpace: [...text.replace(/\s/g, "")].length,
    words: text.split(/\s+/).filter(Boolean).length,
  };
}
export const num = (n) => n.toLocaleString("ko-KR");

/* ---------- 글 내용 ---------- */
// 글에서 고칠 수 있는 칸. 버전과 이 기기 임시저장에도 이 모양 그대로 저장
export const FIELD_KEYS = ["title", "purpose", "content", "photos", "folder_id", "written_on"];
export function postFields(p = {}) {
  return {
    title: typeof p.title === "string" ? p.title : "",
    purpose: typeof p.purpose === "string" ? p.purpose : "",
    content: typeof p.content === "string" ? p.content : "",
    photos: Array.isArray(p.photos) ? p.photos.filter((x) => typeof x === "string") : [],
    folder_id: typeof p.folder_id === "string" ? p.folder_id : null,
    written_on: isDay(p.written_on) ? p.written_on : kstDay(),
  };
}
export const sameFields = (a, b) => JSON.stringify(postFields(a)) === JSON.stringify(postFields(b));
export const isBlank = (f) => !f.title.trim() && !f.purpose.trim() && !plainText(f.content).trim() && !f.photos.length;

/* ---------- 이 기기 임시저장 (자동 저장이 서버에 닿기 전 대비) ---------- */
export const draftKey = (userId, postId) => `writing-draft:${userId}:${postId || "new"}`;
/** 저장된 값이 after(ms)보다 새로울 때만 { at, fields } */
export function readLocalDraft(raw, after = 0) {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    if (typeof d.updatedAt !== "number" || d.updatedAt <= after || !d.fields || typeof d.fields !== "object") return null;
    if (typeof d.fields.title !== "string" || typeof d.fields.content !== "string") return null;
    return { at: d.updatedAt, fields: postFields(d.fields) };
  } catch { return null; }
}

/**
 * 고치기를 열 때 이어 쓸 내용 고르기: 이 기기 임시저장, 서버의 자동 저장·임시저장 중
 * 글(post.updated_at)보다 새로운 것 중 가장 최근 것. 없으면 null
 */
export function pickResume(post, versions, local) {
  const base = post ? Date.parse(post.updated_at) : 0;
  const latest = (versions ?? []).filter((v) => v.kind !== "publish")
    .reduce((a, v) => (!a || Date.parse(v.updated_at) > Date.parse(a.updated_at) ? v : a), null);
  const fromVersion = latest && Date.parse(latest.updated_at) > base ? { source: "version", at: Date.parse(latest.updated_at), fields: postFields(latest.fields), id: latest.id } : null;
  const fromLocal = local && local.at > base ? { source: "local", ...local } : null;
  const best = [fromVersion, fromLocal].filter(Boolean).sort((a, b) => b.at - a.at)[0] ?? null;
  if (!best || (post && sameFields(best.fields, post))) return null;
  return best;
}

/* ---------- 목록, 검색 ---------- */
export function filterPosts(posts, { folder = "", q = "", from = "", to = "", drafts = true } = {}) {
  const needle = q.trim().toLocaleLowerCase();
  return posts.filter((p) =>
    (folder === "" || (folder === "none" ? !p.folder_id : folder === "drafts" ? p.status === "draft" : p.folder_id === folder)) &&
    (drafts || folder === "drafts" || p.status === "published") &&
    (!needle || `${p.title}\n${p.purpose ?? ""}\n${plainText(p.content)}`.toLocaleLowerCase().includes(needle)) &&
    (!from || p.written_on >= from) && (!to || p.written_on <= to),
  ).sort((a, b) => b.written_on.localeCompare(a.written_on) || String(b.updated_at).localeCompare(String(a.updated_at)));
}

/* ---------- 월간 리포트: 올린 글만 ---------- */
export function monthReport(posts, month, folders = []) {
  const list = posts.filter((p) => p.status === "published" && p.written_on.startsWith(`${month}-`))
    .map((p) => ({ ...p, stats: textStats(p.content) }))
    .sort((a, b) => a.written_on.localeCompare(b.written_on));
  const sum = (key, arr = list) => arr.reduce((s, p) => s + p.stats[key], 0);
  const byDay = Array.from({ length: daysInMonth(month) }, (_, i) => {
    const day = `${month}-${String(i + 1).padStart(2, "0")}`;
    const ps = list.filter((p) => p.written_on === day);
    return { day, count: ps.length, chars: sum("chars", ps) };
  });
  const groups = [...folders.map((f) => ({ id: f.id, name: f.name, color: f.color })), { id: null, name: "폴더 없음", color: "#868e96" }];
  const byFolder = groups.map((g) => {
    const ps = list.filter((p) => (p.folder_id ?? null) === g.id);
    return { ...g, count: ps.length, chars: sum("chars", ps) };
  }).filter((g) => g.count > 0).sort((a, b) => b.chars - a.chars);
  return {
    posts: list, count: list.length, chars: sum("chars"), noSpace: sum("noSpace"), words: sum("words"),
    days: byDay.filter((d) => d.count).length, average: list.length ? Math.round(sum("chars") / list.length) : 0,
    longest: list.reduce((a, p) => (!a || p.stats.chars > a.stats.chars ? p : a), null),
    byDay, byFolder,
  };
}
