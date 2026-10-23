import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js?v=202610230926";
import {
  STATUSES, statusName, COLORS, colorOf, GENRES, QUESTIONS, parseHighlights, shelve, doneInYear,
  progressText, progressRatio, bigCover, spineHue, plainText, ymd,
} from "./library.js?v=202610230926";
import { richEditor, toHtml } from "./richtext.js?v=202610230926";

const app = document.getElementById("app");
let sb = null;
const state = { user: null, profile: null };
// 화면을 떠날 때 임시저장을 마무리하는 함수
let leaveHook = null;
window.addEventListener("pagehide", () => leaveHook?.());

/* ---------- 도우미 ---------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const thisYear = () => Number(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul", year: "numeric" }));
const dotDate = (d) => (d ? String(d).slice(0, 10).replaceAll("-", ".") : "");
const kstStamp = (iso) => {
  if (!iso) return "";
  const t = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}.${p(t.getUTCMonth() + 1)}.${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
};

function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), 2800);
}

const ICON = {
  shelf: '<path d="M4 4v16M9 4v16M14 6l4 14M3 20h18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  diary: '<path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4Z"/><path d="M8 4v16"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

/* ---------- 주소(#/경로) ---------- */
function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, query = ""] = raw.split("?");
  return { path, parts: path.split("/").filter(Boolean), params: new URLSearchParams(query) };
}
const go = (hash, replace = false) => {
  if (replace) history.replaceState(null, "", hash); else history.pushState(null, "", hash);
  route();
};

/* ---------- 테마 ---------- */
const themeButton = (extra = "") => `<button class="btn ghost sm theme-btn ${extra}" type="button" data-act="theme" aria-label="라이트/다크 모드 바꾸기" title="라이트/다크 모드 바꾸기"><span class="moon">${icon("moon")}</span><span class="sun">${icon("sun")}</span></button>`;
document.addEventListener("click", (e) => {
  if (!e.target.closest('[data-act="theme"]')) return;
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("meiro-theme", root.dataset.theme); } catch { /* 테마 기억은 선택 사항 */ }
});

/* ---------- 공통 틀 ---------- */
const TABS = [{ path: "/", label: "서재", icon: "shelf" }, { path: "/add", label: "책 추가", icon: "plus" }];

function shell(current, inner) {
  const name = state.profile?.nickname || state.user.email;
  return `<main class="wrap">
    <header class="top">
      <h1 class="lib-mark"><a href="#/">STDL <span>圖書館</span></a></h1>
      <div class="who">
        <span>${esc(name)}</span>
        <a class="btn ghost sm" href="/saytqtul/">${icon("diary")}일기장</a>
        ${themeButton()}
        <button class="btn ghost sm" type="button" data-act="logout">로그아웃</button>
      </div>
    </header>
    <nav class="tabs" aria-label="서재 메뉴">${TABS.map((t) => `<a href="#${t.path}" ${t.path === current ? 'aria-current="page"' : ""}>${icon(t.icon)}${t.label}</a>`).join("")}</nav>
    ${inner}
  </main>`;
}
function bindShell() {
  $('[data-act="logout"]')?.addEventListener("click", async () => { await sb.auth.signOut(); go("#/login", true); });
}
const waiting = () => `<div class="paper notice"><h2>승인을 기다리고 있어요</h2><p>관리자가 가입을 승인하면 서재를 쓸 수 있어요.</p></div>`;
const loading = () => '<p class="muted">불러오는 중…</p>';

/* 표지: 카카오 표지는 큰 크기 → 원래 크기 → 제목 표지 순서로 */
function cover(book, cls = "") {
  const hue = spineHue(book.title);
  const ph = `<span class="cover-ph" style="--h:${hue}"><b>${esc(book.title)}</b><small>${esc((book.authors ?? []).join(", "))}</small></span>`;
  if (!book.cover_url) return `<span class="cover ${cls}">${ph}</span>`;
  return `<span class="cover ${cls}"><img src="${esc(bigCover(book.cover_url))}" data-orig="${esc(book.cover_url)}" alt="" loading="lazy">${ph}</span>`;
}
function bindCovers(root = document) {
  $$(".cover img", root).forEach((img) => {
    const fail = () => {
      if (img.dataset.orig && img.src !== img.dataset.orig) { img.src = img.dataset.orig; img.dataset.orig = ""; }
      else img.remove();
    };
    img.addEventListener("error", fail);
    if (img.complete && img.naturalWidth === 0) fail();
  });
}

async function loadBooks() {
  const { data, error } = await sb.from("books").select("*").order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/* ---------- 로그인 ---------- */
function renderLogin() {
  document.title = "로그인 — STDL 圖書館";
  let mode = "in";
  const draw = () => {
    app.innerHTML = `${themeButton("corner")}<main class="auth"><div class="paper">
      <h1 class="lib-mark" style="text-align:center"><a href="#/">STDL <span>圖書館</span></a></h1>
      <p class="muted small" style="text-align:center;margin:8px 0 0">${mode === "in" ? "일기장과 같은 계정으로 들어가요" : "새 계정을 만들어요"}</p>
      <form id="auth-form">
        ${mode === "up" ? '<label class="field">닉네임<input class="input" id="nick" required autocomplete="nickname"></label>' : ""}
        <label class="field">이메일<input class="input" id="email" type="email" required autocomplete="email"></label>
        <label class="field">비밀번호<input class="input" id="pw" type="password" minlength="6" required autocomplete="${mode === "in" ? "current-password" : "new-password"}"></label>
        <button class="btn primary" type="submit">${mode === "in" ? "로그인" : "가입하기"}</button>
      </form>
      <button class="switch" type="button" id="switch">${mode === "in" ? "계정이 없나요? 가입하기" : "이미 계정이 있나요? 로그인"}</button>
    </div></main>`;
    $("#switch").onclick = () => { mode = mode === "in" ? "up" : "in"; draw(); };
    $("#auth-form").onsubmit = async (e) => {
      e.preventDefault();
      const btn = $("#auth-form button");
      btn.disabled = true;
      const email = $("#email").value.trim(), password = $("#pw").value;
      if (mode === "in") {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) toast("로그인에 실패했어요. 이메일과 비밀번호를 확인해 주세요.", "error");
      } else {
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname, data: { nickname: $("#nick").value.trim() } } });
        if (error) toast(error.message, "error");
        else if (!data.session) toast("확인 메일을 보냈어요. 메일의 링크를 누르면 가입이 완료돼요.");
      }
      btn.disabled = false;
    };
  };
  draw();
}

/* ---------- 서재 ---------- */
async function renderShelf() {
  document.title = "STDL 圖書館";
  app.innerHTML = shell("/", loading());
  bindShell();
  const books = await loadBooks();
  const s = shelve(books);
  const year = thisYear();
  const small = (list, title) => list.length ? `<section class="shelf-row"><h2>${title} <span class="muted">${list.length}</span></h2>
      <ul class="row-list">${list.map((b) => `<li><a href="#/book/${b.id}">${cover(b, "sm")}<span class="row-info"><b>${esc(b.title)}</b>
        <span class="muted small">${esc((b.authors ?? []).join(", "))}</span>
        ${b.status === "reading" ? `<span class="bar"><span style="width:${progressRatio(b) * 100}%"></span></span><span class="muted small">${progressText(b)}</span>` : ""}</span></a></li>`).join("")}</ul></section>` : "";

  // 다 읽은 책은 완독 연도별로
  const years = [...new Set(s.done.map((b) => (b.finished_on ? b.finished_on.slice(0, 4) : "날짜 없음")))];
  const done = s.done.length ? years.map((y) => {
    const list = s.done.filter((b) => (b.finished_on ? b.finished_on.slice(0, 4) : "날짜 없음") === y);
    return `<section class="shelf-year"><h2>${y === "날짜 없음" ? y : `${y}년`} <span class="muted">${list.length}권</span></h2>
      <ul class="shelf">${list.map((b) => `<li><a href="#/book/${b.id}" title="${esc(b.title)}">${cover(b)}
        <span class="shelf-title">${esc(b.title)}</span>
        ${b.rating ? `<span class="stars-sm" aria-label="별점 ${b.rating}점">${"★".repeat(b.rating)}<span>${"★".repeat(5 - b.rating)}</span></span>` : ""}</a></li>`).join("")}</ul></section>`;
  }).join("") : "";

  $("main").lastElementChild.remove();
  $("main").insertAdjacentHTML("beforeend", `
    <p class="year-count"><b>${year}년</b>에 읽은 책 <b class="num">${doneInYear(books, year)}</b>권</p>
    ${books.length ? "" : `<div class="paper notice"><h2>서재가 비어 있어요</h2><p>첫 책을 추가해 보세요.</p><p style="margin-top:20px"><a class="btn primary" href="#/add">${icon("plus")}책 추가</a></p></div>`}
    ${small(s.reading, "읽는 중")}
    ${done}
    ${small(s.want, "읽고 싶은")}
    ${small(s.dropped, "그만둠")}`);
  bindCovers();
}

/* ---------- 책 추가 ---------- */
function renderAdd(params) {
  document.title = "책 추가 — STDL 圖書館";
  app.innerHTML = shell("/add", `
    <form class="search" id="search"><input class="input" id="q" type="search" placeholder="책 제목, 저자, ISBN" aria-label="책 검색" value="${esc(params.get("q") ?? "")}" autofocus>
      <button class="btn primary" type="submit">${icon("search")}검색</button></form>
    <div id="results"></div>
    <details class="manual" id="manual"><summary>찾는 책이 없으면 직접 입력</summary>
      <form id="manual-form" class="manual-form">
        <label class="field">제목<input class="input" id="m-title" required></label>
        <label class="field">저자 <span class="muted">(여러 명이면 쉼표로)</span><input class="input" id="m-authors"></label>
        <label class="field">출판사<input class="input" id="m-publisher"></label>
        <div class="add-as">${["reading", "done", "want"].map((s) => `<button class="btn ${s === "reading" ? "primary" : "outline"}" type="submit" value="${s}">${statusName(s)}(으)로 추가</button>`).join("")}</div>
      </form></details>`);
  bindShell();

  const search = async (q) => {
    const box = $("#results");
    if (!q) { box.innerHTML = ""; return; }
    box.innerHTML = loading();
    const { data, error } = await sb.functions.invoke("book-search", { body: { query: q } });
    if (error || data?.error) {
      box.innerHTML = `<div class="paper notice"><h2>검색하지 못했어요</h2><p>${esc(data?.error ?? "책 검색 기능이 아직 연결되지 않았을 수 있어요.")} 아래 '직접 입력'으로 추가할 수 있어요.</p></div>`;
      $("#manual").open = true;
      return;
    }
    const docs = data.documents ?? [];
    box.innerHTML = docs.length ? `<ul class="results">${docs.map((d, i) => `<li>
        ${cover({ title: d.title, authors: d.authors, cover_url: d.thumbnail }, "sm")}
        <div class="row-info"><b>${esc(d.title)}</b><span class="muted small">${esc((d.authors ?? []).join(", "))}${d.publisher ? ` · ${esc(d.publisher)}` : ""}${d.datetime ? ` · ${d.datetime.slice(0, 4)}` : ""}</span>
          <div class="add-as">${["reading", "done", "want"].map((s) => `<button class="btn sm ${s === "reading" ? "primary" : "outline"}" type="button" data-i="${i}" data-s="${s}">${statusName(s)}</button>`).join("")}</div></div>
      </li>`).join("")}</ul>` : '<p class="empty">찾는 책이 없어요. 다른 낱말로 검색하거나 직접 입력해 주세요.</p>';
    bindCovers(box);
    $$("[data-i]", box).forEach((b) => b.onclick = () => {
      const d = docs[Number(b.dataset.i)];
      addBook({ title: d.title, authors: d.authors ?? [], publisher: d.publisher ?? "", isbn: d.isbn ?? "", cover_url: d.thumbnail ?? "" }, b.dataset.s);
    });
  };
  $("#search").onsubmit = (e) => {
    e.preventDefault();
    const q = $("#q").value.trim();
    history.replaceState(null, "", `#/add${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    search(q);
  };
  $("#manual-form").onsubmit = (e) => {
    e.preventDefault();
    addBook({ title: $("#m-title").value.trim(), authors: $("#m-authors").value.split(",").map((a) => a.trim()).filter(Boolean), publisher: $("#m-publisher").value.trim() }, e.submitter?.value ?? "reading");
  };
  if (params.get("q")) search(params.get("q"));
}

async function addBook(fields, status) {
  if (fields.isbn) {
    const { data: same } = await sb.from("books").select("id").eq("isbn", fields.isbn).maybeSingle();
    if (same) { toast("이미 서재에 있는 책이에요."); go(`#/book/${same.id}`); return; }
  }
  const today = ymd(new Date());
  const row = { ...fields, status, started_on: status === "want" ? null : today, finished_on: status === "done" ? today : null };
  const { data, error } = await sb.from("books").insert(row).select().single();
  if (error) { toast("추가하지 못했어요.", "error"); return; }
  toast(`'${fields.title}'을(를) 서재에 꽂았어요`);
  go(status === "done" ? `#/book/${data.id}/edit` : `#/book/${data.id}`);
}

/* ---------- 책 한 권 ---------- */
async function renderBook(id) {
  app.innerHTML = shell("", loading());
  bindShell();
  const [{ data: b }, { data: hs }] = await Promise.all([
    sb.from("books").select("*").eq("id", id).maybeSingle(),
    sb.from("highlights").select("*").eq("book_id", id).order("page", { ascending: true, nullsFirst: false }),
  ]);
  if (!b) { $("main").lastElementChild.outerHTML = '<p class="empty">책을 찾을 수 없어요.</p>'; return; }
  document.title = `${b.title} — STDL 圖書館`;
  const highlights = hs ?? [];
  const answered = QUESTIONS.filter((q) => b[q.key]?.trim());
  const hasReview = plainText(b.review).trim();

  $("main").lastElementChild.remove();
  $("main").insertAdjacentHTML("beforeend", `
    <article class="book">
      <header class="book-head">
        ${cover(b, "lg")}
        <div class="book-info">
          <h2>${esc(b.title)}</h2>
          <p class="muted">${esc((b.authors ?? []).join(", "))}${b.publisher ? ` · ${esc(b.publisher)}` : ""}</p>
          <div class="status-row">
            <label class="sr" for="status">상태</label>
            <select class="input status" id="status">${STATUSES.map((s) => `<option value="${s.id}" ${s.id === b.status ? "selected" : ""}>${s.name}</option>`).join("")}</select>
            <span class="muted small">${b.format === "paper" ? "종이책" : "전자책"}</span>
          </div>
          ${b.status === "reading" ? `<div class="progress">
            <input type="range" id="progress" min="0" max="${b.progress_unit === "page" ? (b.total_pages ?? 1000) : 100}" value="${b.progress ?? 0}" aria-label="진도">
            <output id="progress-out">${progressText(b)}</output></div>` : ""}
          <p class="dates muted small">${[b.started_on && `${dotDate(b.started_on)} 시작`, b.finished_on && `${dotDate(b.finished_on)} 완독`].filter(Boolean).join(" · ")}</p>
          ${b.rating ? `<p class="stars" aria-label="별점 ${b.rating}점">${"★".repeat(b.rating)}<span>${"★".repeat(5 - b.rating)}</span></p>` : ""}
          ${b.genre ? `<p class="genre">${esc(b.genre)}</p>` : ""}
          <div class="book-actions">
            <a class="btn primary" href="#/book/${b.id}/edit">정리하기</a>
            <a class="btn outline" href="#/book/${b.id}/highlights">밑줄 추가</a>
            <button class="btn ghost danger sm" type="button" id="del">책 삭제</button>
          </div>
        </div>
      </header>

      ${b.one_line ? `<blockquote class="one-line">${esc(b.one_line)}</blockquote>` : ""}

      ${answered.length || hasReview ? `<section class="reflect">
        ${answered.map((q) => `<div class="qa"><h3>${q.label}</h3><p>${esc(b[q.key])}</p></div>`).join("")}
        ${hasReview ? `<div class="qa"><h3>감상</h3><div class="review">${toHtml(b.review)}</div></div>` : ""}
      </section>` : b.status === "done" ? `<div class="paper notice slim"><p>아직 감상을 남기지 않았어요.</p><p style="margin-top:12px"><a class="btn primary" href="#/book/${b.id}/edit">정리하기</a></p></div>` : ""}

      <section class="hl-section" id="highlights">
        <div class="section-head"><h3>밑줄 <span class="muted">${highlights.length}</span></h3>
          ${highlights.length ? `<div class="chips hl-filter">${COLORS.filter((c) => highlights.some((h) => h.color === c.id)).map((c) => `<button class="hl-dot" type="button" data-c="${c.id}" aria-pressed="false" style="--c:${c.value}" title="${c.name}만 보기"></button>`).join("")}</div>` : ""}</div>
        ${highlights.length ? `<ul class="hl-list">${highlights.map((h) => `<li class="hl c-${h.color}" data-color="${h.color}" style="--c:${colorOf(h.color).value}">
            <p>${esc(h.text)}</p>
            <div class="hl-meta"><span>${h.page ? `${h.page}p` : ""}${h.page && h.highlighted_at ? " · " : ""}${kstStamp(h.highlighted_at)}</span>
              <button class="btn ghost sm" type="button" data-del="${h.id}">삭제</button></div></li>`).join("")}</ul>`
          : `<p class="empty-hint">밀리의 서재 하이라이트를 복사해서 <a href="#/book/${b.id}/highlights">한꺼번에 붙여 넣을</a> 수 있어요.</p>`}
      </section>
    </article>`);
  bindCovers();

  // 상태 바꾸기: 다 읽음이면 완독일, 읽는 중이면 시작일을 오늘로 채움
  $("#status").onchange = async (e) => {
    const status = e.target.value, today = ymd(new Date());
    const patch = { status, updated_at: new Date().toISOString() };
    if (status === "done" && !b.finished_on) patch.finished_on = today;
    if (status === "reading" && !b.started_on) patch.started_on = today;
    if (status === "done" && b.progress_unit === "percent") patch.progress = 100;
    const { error } = await sb.from("books").update(patch).eq("id", b.id);
    if (error) { toast("바꾸지 못했어요.", "error"); return; }
    toast(`${statusName(status)}(으)로 바꿨어요`);
    if (status === "done" && !answered.length && !hasReview) go(`#/book/${b.id}/edit`); else renderBook(b.id);
  };
  const range = $("#progress");
  if (range) {
    range.oninput = () => { $("#progress-out").textContent = progressText({ ...b, progress: Number(range.value) }); };
    range.onchange = async () => { await sb.from("books").update({ progress: Number(range.value), updated_at: new Date().toISOString() }).eq("id", b.id); };
  }
  $("#del").onclick = async () => {
    if (!confirm(`'${b.title}'을(를) 서재에서 뺄까요? 감상과 밑줄도 함께 지워져요.`)) return;
    const { error } = await sb.from("books").delete().eq("id", b.id);
    if (error) { toast("삭제하지 못했어요.", "error"); return; }
    toast("서재에서 뺐어요");
    go("#/", true);
  };
  $$("[data-del]").forEach((btn) => btn.onclick = async () => {
    await sb.from("highlights").delete().eq("id", btn.dataset.del);
    btn.closest("li").remove();
  });
  // 색 하나만 골라 보기
  $$(".hl-dot").forEach((dot) => dot.onclick = () => {
    const on = dot.getAttribute("aria-pressed") !== "true";
    $$(".hl-dot").forEach((d) => d.setAttribute("aria-pressed", "false"));
    dot.setAttribute("aria-pressed", String(on));
    $$(".hl-list li").forEach((li) => { li.hidden = on && li.dataset.color !== dot.dataset.c; });
  });
}

/* ---------- 정리하기 ---------- */
async function renderEdit(id) {
  app.innerHTML = shell("", loading());
  bindShell();
  const { data: b } = await sb.from("books").select("*").eq("id", id).maybeSingle();
  if (!b) { $("main").lastElementChild.outerHTML = '<p class="empty">책을 찾을 수 없어요.</p>'; return; }
  document.title = `정리하기: ${b.title} — STDL 圖書館`;

  // 임시저장: 쓰던 감상이 날아가지 않게 이 기기에 저장
  const key = `library-draft:${state.user.id}:${b.id}`;
  let f = { rating: b.rating, one_line: b.one_line, q_thoughts: b.q_thoughts, q_further: b.q_further, q_learned: b.q_learned, review: b.review,
    status: b.status, started_on: b.started_on ?? "", finished_on: b.finished_on ?? "", genre: b.genre, format: b.format, total_pages: b.total_pages ?? "" };
  let restored = false;
  try {
    const d = JSON.parse(localStorage.getItem(key) ?? "null");
    if (d && d.updatedAt > Date.parse(b.updated_at)) { f = { ...f, ...d.fields }; restored = true; }
  } catch { /* 임시저장은 선택 사항 */ }
  let timer = null, dirty = false;
  const flush = () => { if (!dirty) return; try { localStorage.setItem(key, JSON.stringify({ updatedAt: Date.now(), fields: f })); dirty = false; $("#draft").textContent = "이 기기에 임시저장됨"; } catch { /* 저장 버튼으로 저장 */ } };
  const changed = () => { dirty = true; $("#draft").textContent = "임시저장 중…"; clearTimeout(timer); timer = setTimeout(flush, 600); };
  leaveHook = flush;

  $("main").lastElementChild.remove();
  $("main").insertAdjacentHTML("beforeend", `
    <a class="back" href="#/book/${b.id}">${icon("left")}${esc(b.title)}</a>
    <form class="paper edit" id="edit">
      <div class="edit-head">${cover(b, "sm")}<div><h2>정리하기</h2><p class="muted small">${esc(b.title)} · ${esc((b.authors ?? []).join(", "))}</p></div></div>
      <p class="status" id="draft">${restored ? "임시저장한 내용을 불러왔어요" : ""}</p>

      <div class="grid2">
        <label class="field">상태<select class="input" id="f-status">${STATUSES.map((s) => `<option value="${s.id}" ${s.id === f.status ? "selected" : ""}>${s.name}</option>`).join("")}</select></label>
        <label class="field">장르<select class="input" id="f-genre"><option value="">고르지 않음</option>${GENRES.map((g) => `<option ${g === f.genre ? "selected" : ""}>${g}</option>`).join("")}</select></label>
        <label class="field">시작한 날<input class="input" type="date" id="f-started" value="${esc(f.started_on)}"></label>
        <label class="field">다 읽은 날<input class="input" type="date" id="f-finished" value="${esc(f.finished_on)}"></label>
        <label class="field">책 형태<select class="input" id="f-format"><option value="ebook" ${f.format !== "paper" ? "selected" : ""}>전자책 (진도는 %)</option><option value="paper" ${f.format === "paper" ? "selected" : ""}>종이책 (진도는 쪽수)</option></select></label>
        <label class="field" id="pages-field" ${f.format === "paper" ? "" : "hidden"}>전체 쪽수<input class="input" type="number" min="1" id="f-pages" value="${esc(f.total_pages)}"></label>
      </div>

      <div class="field-block"><span class="label">별점</span>
        <div class="star-input" role="radiogroup" aria-label="별점">${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" data-star="${n}" aria-checked="${f.rating === n}" aria-label="${n}점">★</button>`).join("")}
          <span class="muted small" id="star-text"></span></div></div>

      <label class="field-block"><span class="label">한 줄 평</span><input class="input one-line-input" id="f-one" maxlength="120" placeholder="이 책을 한 문장으로" value="${esc(f.one_line)}"></label>

      ${QUESTIONS.map((q) => `<label class="field-block"><span class="label">${q.label}</span><textarea class="input grow" data-q="${q.key}" rows="3">${esc(f[q.key])}</textarea></label>`).join("")}

      <div class="field-block"><span class="label">감상</span><div id="review"></div></div>

      <div class="actions"><a class="btn ghost" href="#/book/${b.id}" id="cancel">취소</a><button class="btn primary" type="submit" id="save">저장</button></div>
    </form>`);
  bindCovers();

  const drawStars = () => {
    $$("[data-star]").forEach((s) => { s.setAttribute("aria-checked", String(f.rating === Number(s.dataset.star))); s.classList.toggle("on", Number(s.dataset.star) <= (f.rating ?? 0)); });
    $("#star-text").textContent = f.rating ? `${f.rating}점` : "누른 별을 다시 누르면 지워져요";
  };
  drawStars();
  $$("[data-star]").forEach((s) => s.onclick = () => { const n = Number(s.dataset.star); f.rating = f.rating === n ? null : n; drawStars(); changed(); });

  const grow = (t) => { t.style.height = "auto"; t.style.height = `${t.scrollHeight + 2}px`; };
  $$("textarea.grow").forEach((t) => { grow(t); t.oninput = () => { f[t.dataset.q] = t.value; grow(t); changed(); }; });
  $("#f-one").oninput = (e) => { f.one_line = e.target.value; changed(); };
  $("#f-status").onchange = (e) => {
    f.status = e.target.value;
    if (f.status === "done" && !$("#f-finished").value) { $("#f-finished").value = ymd(new Date()); f.finished_on = $("#f-finished").value; }
    changed();
  };
  $("#f-genre").onchange = (e) => { f.genre = e.target.value; changed(); };
  $("#f-started").onchange = (e) => { f.started_on = e.target.value; changed(); };
  $("#f-finished").onchange = (e) => { f.finished_on = e.target.value; changed(); };
  $("#f-format").onchange = (e) => { f.format = e.target.value; $("#pages-field").hidden = f.format !== "paper"; changed(); };
  $("#f-pages").oninput = (e) => { f.total_pages = e.target.value; changed(); };
  richEditor($("#review"), f.review ?? "", (v) => { f.review = v; changed(); });

  $("#cancel").onclick = () => { clearTimeout(timer); dirty = false; try { localStorage.removeItem(key); } catch { /* 없어도 됨 */ } };
  $("#edit").onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("#save");
    btn.disabled = true; btn.textContent = "저장 중…";
    const paper = f.format === "paper";
    const patch = {
      rating: f.rating ?? null, one_line: f.one_line.trim(), q_thoughts: f.q_thoughts, q_further: f.q_further, q_learned: f.q_learned, review: f.review ?? "",
      status: f.status, genre: f.genre, started_on: f.started_on || null, finished_on: f.finished_on || null,
      format: f.format, progress_unit: paper ? "page" : "percent", total_pages: paper && Number(f.total_pages) > 0 ? Number(f.total_pages) : null,
      updated_at: new Date().toISOString(),
    };
    if (paper !== (b.format === "paper")) patch.progress = 0; // 단위가 바뀌면 진도를 새로 셈
    const { error } = await sb.from("books").update(patch).eq("id", b.id);
    if (error) { btn.disabled = false; btn.textContent = "저장"; toast("저장하지 못했어요.", "error"); return; }
    clearTimeout(timer); dirty = false;
    try { localStorage.removeItem(key); } catch { /* 없어도 됨 */ }
    toast("저장했어요");
    go(`#/book/${b.id}`, true);
  };
}

/* ---------- 밑줄 붙여넣기 ---------- */
async function renderHighlights(id) {
  app.innerHTML = shell("", loading());
  bindShell();
  const { data: b } = await sb.from("books").select("id, title, authors, cover_url").eq("id", id).maybeSingle();
  if (!b) { $("main").lastElementChild.outerHTML = '<p class="empty">책을 찾을 수 없어요.</p>'; return; }
  document.title = `밑줄 추가: ${b.title} — STDL 圖書館`;
  let color = "yellow";
  $("main").lastElementChild.remove();
  $("main").insertAdjacentHTML("beforeend", `
    <a class="back" href="#/book/${b.id}">${icon("left")}${esc(b.title)}</a>
    <div class="paper edit">
      <div class="edit-head">${cover(b, "sm")}<div><h2>밑줄 추가</h2><p class="muted small">밀리의 서재 하이라이트를 복사해서 붙여 넣으세요. 여러 개를 한꺼번에 넣어도 돼요.</p></div></div>
      <textarea class="input paste" id="paste" rows="8" placeholder="가족주의는 남한뿐만 아니라 북한과 해외동포 사회에서도 나타난다.&#10;24p · 2026.10.23 18:16&#10;&#10;쪽수·시각 줄이 없으면 한 줄에 한 문장으로 나눠요."></textarea>
      <div class="field-block"><span class="label">색</span>
        <div class="chips" id="colors">${COLORS.map((c) => `<button type="button" class="hl-dot big" data-c="${c.id}" aria-pressed="${c.id === color}" style="--c:${c.value}" aria-label="${c.name}"><span>${c.name}</span></button>`).join("")}</div></div>
      <div id="preview"></div>
      <div class="actions"><a class="btn ghost" href="#/book/${b.id}">취소</a><button class="btn primary" type="button" id="add" disabled>추가</button></div>
    </div>`);
  bindCovers();

  let parsed = [];
  const draw = () => {
    parsed = parseHighlights($("#paste").value);
    $("#add").disabled = !parsed.length;
    $("#add").textContent = parsed.length ? `${parsed.length}개 추가` : "추가";
    $("#preview").innerHTML = parsed.length ? `<p class="muted small">미리보기 ${parsed.length}개</p><ul class="hl-list">${parsed.map((h) => `<li class="hl" style="--c:${colorOf(color).value}"><p>${esc(h.text)}</p>
      <div class="hl-meta"><span>${h.page ? `${h.page}p` : "쪽수 없음"}${h.highlighted_at ? ` · ${kstStamp(h.highlighted_at)}` : ""}</span></div></li>`).join("")}</ul>` : "";
  };
  $("#paste").oninput = draw;
  $$("#colors [data-c]").forEach((d) => d.onclick = () => {
    color = d.dataset.c;
    $$("#colors [data-c]").forEach((x) => x.setAttribute("aria-pressed", String(x === d)));
    draw();
  });
  $("#add").onclick = async () => {
    const rows = parsed.map((h) => ({ ...h, color, book_id: b.id }));
    const { error } = await sb.from("highlights").insert(rows);
    if (error) { toast("추가하지 못했어요.", "error"); return; }
    await sb.from("books").update({ updated_at: new Date().toISOString() }).eq("id", b.id);
    toast(`밑줄 ${rows.length}개를 추가했어요`);
    go(`#/book/${b.id}`, true);
  };
}

/* ---------- 라우터 ---------- */
async function route() {
  leaveHook?.();
  leaveHook = null;
  const { path, parts, params } = parseHash();
  if (path === "/login") return state.user ? go("#/", true) : renderLogin();
  if (!state.user) return go("#/login", true);
  if (!state.profile) {
    const { data } = await sb.from("profiles").select("nickname, approved").eq("id", state.user.id).maybeSingle();
    state.profile = data ?? { nickname: "", approved: false };
  }
  if (!state.profile.approved) { app.innerHTML = shell("/", waiting()); bindShell(); return; }
  try {
    if (parts[0] === "add") return renderAdd(params);
    if (parts[0] === "book" && parts[1]) {
      if (parts[2] === "edit") return await renderEdit(parts[1]);
      if (parts[2] === "highlights") return await renderHighlights(parts[1]);
      return await renderBook(parts[1]);
    }
    return await renderShelf();
  } catch {
    app.innerHTML = shell("/", '<div class="paper notice"><h2>불러오지 못했어요</h2><p>잠시 뒤 새로고침해 주세요. 계속되면 데이터베이스 설정(library.sql)을 확인해 주세요.</p></div>');
    bindShell();
  }
}

async function start() {
  if ((!SUPABASE_URL || !SUPABASE_ANON_KEY) && !window.__LIBRARY_TEST_CLIENT__) {
    app.innerHTML = '<main class="auth"><div class="paper notice"><h2>연결 준비 중</h2><p>js/config.js에 Supabase 주소와 키를 넣어 주세요.</p></div></main>';
    return;
  }
  sb = window.__LIBRARY_TEST_CLIENT__ ?? (await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm"))
    .createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true } });
  const { data } = await sb.auth.getSession();
  state.user = data.session?.user ?? null;
  if (new URLSearchParams(location.search).has("code")) history.replaceState(null, "", location.pathname + (state.user ? "#/" : "#/login"));
  sb.auth.onAuthStateChange((event, session) => {
    const before = state.user?.id;
    state.user = session?.user ?? null;
    if (state.user?.id === before) return;
    state.profile = null;
    if (event === "SIGNED_IN" && parseHash().path === "/login") go("#/", true);
    else if (!state.user) go("#/login", true);
  });
  window.addEventListener("hashchange", route);
  route();
}

start();
