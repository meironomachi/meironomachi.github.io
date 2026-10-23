// STDL 圖書館 규칙: 책 상태, 밑줄 붙여넣기, 서식 있는 감상, 서재 정리

export const STATUSES = [
  { id: "reading", name: "읽는 중" },
  { id: "done", name: "다 읽음" },
  { id: "want", name: "읽고 싶은" },
  { id: "dropped", name: "그만둠" },
];
export const statusName = (id) => STATUSES.find((s) => s.id === id)?.name ?? "";

// 밀리의 서재 하이라이트 색 (마지막은 색 없는 밑줄)
export const COLORS = [
  { id: "yellow", name: "노랑", value: "#f5c518" },
  { id: "red", name: "빨강", value: "#ef6a5a" },
  { id: "lime", name: "연두", value: "#b5e035" },
  { id: "sky", name: "하늘", value: "#4fb6ee" },
  { id: "purple", name: "보라", value: "#8b6cf0" },
  { id: "underline", name: "밑줄", value: "#e5484d" },
];
export const colorOf = (id) => COLORS.find((c) => c.id === id) ?? COLORS[0];

export const GENRES = ["인문", "사회", "역사", "과학", "철학", "예술", "소설", "에세이", "시", "자기계발", "경제·경영", "기타"];

export const QUESTIONS = [
  { key: "q_thoughts", label: "이 책을 읽고 든 생각" },
  { key: "q_further", label: "더 생각해 볼 지점" },
  { key: "q_learned", label: "어떤 것을 알게 되었을까?" },
];

/* ---------- 밑줄 붙여넣기 ---------- */
// 밀리의 서재: "24p · 2026.10.23 18:16" 줄이 문장 바로 뒤에 붙음
const META = /^(\d+)\s*p\s*[·•・ㆍ∙|-]?\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s+(\d{1,2}):(\d{2})\s*$/i;
const PAGE_ONLY = /^(?:p\.?\s*)?(\d+)\s*(?:p|쪽|페이지)\s*$/i;
const NOISE = /^(?:["“”'‘’]+|출처\s*[:：].*|.*밀리의\s*서재.*|https?:\/\/\S+|공유하기|더보기)$/;
const trimQuotes = (s) => s.replace(/^[\s"“”'‘’]+|[\s"“”'‘’]+$/g, "");

/**
 * 붙여 넣은 글을 밑줄 목록으로 나눔.
 * 1) 쪽수·시각 줄이 있으면 그 줄 앞까지를 한 문장으로
 * 2) 없으면 빈 줄로 나눔, 빈 줄도 없으면 한 줄에 한 문장
 */
export function parseHighlights(raw) {
  const lines = String(raw ?? "").replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim());
  const out = [];
  if (lines.some((l) => META.test(l))) {
    let buf = [];
    for (const line of lines) {
      const m = line.match(META);
      if (m) {
        const text = trimQuotes(buf.join(" ").replace(/\s+/g, " "));
        if (text) {
          const [, page, y, mo, d, h, mi] = m;
          out.push({ text, page: Number(page), highlighted_at: localIso(+y, +mo, +d, +h, +mi) });
        }
        buf = [];
      } else if (line && !NOISE.test(line)) buf.push(line);
    }
    const rest = trimQuotes(buf.join(" "));
    if (rest) out.push({ text: rest, page: null, highlighted_at: null });
    return out;
  }
  // 앞뒤 빈 줄은 무시하고, 문장 사이에 빈 줄이 있을 때만 빈 줄로 나눔
  const first = lines.findIndex(Boolean), last = lines.findLastIndex(Boolean);
  const body = first < 0 ? [] : lines.slice(first, last + 1);
  const blocks = body.includes("")
    ? body.join("\n").split(/\n\s*\n/).map((b) => b.split("\n"))
    : body.map((l) => [l]);
  for (const block of blocks) {
    let page = null;
    const kept = block.filter((l) => {
      const p = l.match(PAGE_ONLY);
      if (p) { page = Number(p[1]); return false; }
      return l && !NOISE.test(l);
    });
    const text = trimQuotes(kept.join(" ").replace(/\s+/g, " "));
    if (text) out.push({ text, page, highlighted_at: null });
  }
  return out;
}

// 밀리에 적힌 시각은 한국 시간
function localIso(y, mo, d, h, mi) {
  return new Date(Date.UTC(y, mo - 1, d, h - 9, mi)).toISOString();
}

/* ---------- 서재 ---------- */
/** 서재 정리: 상태별로 나누고, 다 읽은 책은 완독일 최신순 */
export function shelve(books) {
  const by = (s) => books.filter((b) => b.status === s);
  const recent = (a, b) => String(b.finished_on ?? b.updated_at ?? "").localeCompare(String(a.finished_on ?? a.updated_at ?? ""));
  const touched = (a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""));
  return { reading: by("reading").sort(touched), done: by("done").sort(recent), want: by("want").sort(touched), dropped: by("dropped").sort(touched) };
}

/** 해당 연도에 다 읽은 책 수 (완독일 기준) */
export const doneInYear = (books, year) => books.filter((b) => b.status === "done" && String(b.finished_on ?? "").startsWith(`${year}-`)).length;

/** 진도 글자: 52% / 120/340쪽 */
export function progressText(b) {
  if (b.progress_unit === "page") return b.total_pages ? `${b.progress ?? 0}/${b.total_pages}쪽` : `${b.progress ?? 0}쪽`;
  return `${Math.max(0, Math.min(100, b.progress ?? 0))}%`;
}
export function progressRatio(b) {
  if (b.progress_unit === "page") return b.total_pages ? Math.min(1, (b.progress ?? 0) / b.total_pages) : 0;
  return Math.max(0, Math.min(100, b.progress ?? 0)) / 100;
}

/** 카카오 표지는 작은 크기로 오므로 큰 크기 주소로 바꿔 봄 (안 되면 원래 주소로) */
export function bigCover(url) {
  return typeof url === "string" ? url.replace(/\/thumb\/R\d+x\d+(\.q\d+)?\//, "/thumb/R360x520.q85/") : url;
}

/** 표지가 없을 때 쓸 색 (제목으로 정해서 늘 같은 색) */
export function spineHue(title) {
  return [...String(title)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
}

/* ---------- 서식 있는 감상 (일기장과 같은 형식) ---------- */
export const RICH_MARK = "<!--rich-->";
export const isRich = (content) => typeof content === "string" && content.startsWith(RICH_MARK);
const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
export function plainText(content) {
  if (!isRich(content)) return content ?? "";
  return content.slice(RICH_MARK.length)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m])
    .replace(/\n+$/, "");
}

export const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/* ---------- 독서 타이머 ---------- */
// 기록 하나 = 시작~끝 사이에서 멈춘 구간(pauses)을 뺀 시간. 끝이 없으면 아직 읽는 중
// 하루의 기준은 일기장 타임테이블처럼 한국 시간 새벽 6시 (새벽 1시에 읽은 건 전날 밤)
export const DAY_START_HOUR = 6;
const KST = 9 * 3600 * 1000;

/** 실제로 읽은 구간들 [[시작ms, 끝ms], …] */
export function activeIntervals(s, now = Date.now()) {
  const start = Date.parse(s.started_at);
  const end = s.ended_at ? Date.parse(s.ended_at) : now;
  const pauses = (s.pauses ?? []).map((p) => [Date.parse(p.from), p.to ? Date.parse(p.to) : end]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  const out = [];
  let cur = start;
  for (const [a, b] of pauses) {
    if (a > cur) out.push([cur, Math.min(a, end)]);
    cur = Math.max(cur, b);
    if (cur >= end) break;
  }
  if (cur < end) out.push([cur, end]);
  return out.filter(([a, b]) => b > a);
}
export const sessionMs = (s, now) => activeIntervals(s, now).reduce((sum, [a, b]) => sum + (b - a), 0);
export const isPaused = (s) => !s.ended_at && (s.pauses ?? []).some((p) => !p.to);

/** 그 시각이 속한 하루 (YYYY-MM-DD, 새벽 6시 기준) */
export function dayKey(ms) {
  const d = new Date(ms + KST - DAY_START_HOUR * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
/** 그 하루가 시작하는 시각(ms) */
export const dayStartMs = (day) => Date.parse(`${day}T00:00:00Z`) - KST + DAY_START_HOUR * 3600 * 1000;

/** 하루별 읽은 분 { "2026-10-23": 42, … } — 하루 경계를 넘는 기록은 나눠서 셈 */
export function minutesByDay(sessions, now = Date.now()) {
  const out = {};
  for (const s of sessions) {
    for (let [a, b] of activeIntervals(s, now)) {
      while (a < b) {
        const day = dayKey(a);
        const cut = Math.min(b, dayStartMs(day) + 24 * 3600 * 1000);
        out[day] = (out[day] ?? 0) + (cut - a) / 60000;
        a = cut;
      }
    }
  }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k]);
  return out;
}

/** 오늘(아직 안 읽었으면 어제)부터 거꾸로 이어서 읽은 날 수 */
export function streak(byDay, today) {
  const prev = (day) => dayKey(dayStartMs(day) - 3600 * 1000);
  let day = byDay[today] > 0 ? today : prev(today);
  let n = 0;
  while (byDay[day] > 0) { n++; day = prev(day); }
  return n;
}

/** 독서 달력 칸 색 단계 0~4 */
export const readingLevel = (min) => (!min ? 0 : min < 15 ? 1 : min < 30 ? 2 : min < 60 ? 3 : 4);

export const clockOf = (ms) => {
  const t = Math.floor(ms / 1000), p = (n) => String(n).padStart(2, "0");
  return `${p(Math.floor(t / 3600))}:${p(Math.floor(t / 60) % 60)}:${p(t % 60)}`;
};
export const durationOf = (ms) => {
  const m = Math.round(ms / 60000), h = Math.floor(m / 60);
  return h ? `${h}시간${m % 60 ? ` ${m % 60}분` : ""}` : `${m}분`;
};
