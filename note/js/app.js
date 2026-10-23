import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js?v=202610231531";
import {
  KIND_NAME, safeColor, kstDay, isDay, isMonth, shiftMonth, plainText, textStats, num,
  postFields, sameFields, isBlank, draftKey, readLocalDraft, pickResume, filterPosts, monthReport,
} from "./note.js?v=202610231531";
import { richEditor, toHtml } from "./richtext.js?v=202610231531";

const BUCKET = "diary-photos"; // 일기장과 같은 사진 저장소 (내 폴더 안 note/ 아래)
const AUTO_MS = 4000; // 입력이 멈추고 4초 뒤 서버에 자동 저장
const app = document.getElementById("app");
let sb = null;
const state = { user: null, profile: null, folders: [] };
// 화면을 떠날 때 자동 저장을 마무리하는 함수
let leaveHook = null;
window.addEventListener("pagehide", () => leaveHook?.());

/* ---------- 도우미 ---------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const longDate = (day) => {
  const [y, m, d] = day.split("-").map(Number);
  return `${y}년 ${m}월 ${d}일 ${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}요일`;
};
const kstStamp = (iso) => {
  if (!iso) return "";
  const t = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}.${p(t.getUTCMonth() + 1)}.${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
};
const hhmm = (ms) => kstStamp(new Date(ms).toISOString()).slice(11);

function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), 2800);
}

const ICON = {
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  diary: '<path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4Z"/><path d="M8 4v16"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

/* ---------- 주소(#/경로?값) ---------- */
function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, query = ""] = raw.split("?");
  return { path, parts: path.split("/").filter(Boolean), params: new URLSearchParams(query) };
}
const go = (hash, replace = false) => {
  if (replace) history.replaceState(null, "", hash); else history.pushState(null, "", hash);
  route();
};

/* ---------- 테마 (meiro.kr 공통) ---------- */
const themeButton = (extra = "") => `<button class="btn ghost sm theme-btn ${extra}" type="button" data-act="theme" aria-label="라이트/다크 모드 바꾸기" title="라이트/다크 모드 바꾸기"><span class="moon">${icon("moon")}</span><span class="sun">${icon("sun")}</span></button>`;
document.addEventListener("click", (e) => {
  if (!e.target.closest('[data-act="theme"]')) return;
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("meiro-theme", root.dataset.theme); } catch { /* 테마 기억은 선택 사항 */ }
});

/* ---------- 공통 틀 ---------- */
const TABS = [
  { path: "/", label: "글", icon: "list" },
  { path: "/write", label: "새 글", icon: "pen" },
  { path: "/reports", label: "월간 리포트", icon: "chart" },
  { path: "/search", label: "검색", icon: "search" },
];
const brand = () => "MEIRO<span>NOTE</span>";

function shell(current, inner) {
  const name = state.profile?.nickname || state.user.email;
  return `<main class="wrap">
    <header class="top">
      <h1 class="note-mark"><a href="#/">${brand()}</a></h1>
      <div class="who">
        <a class="btn ghost sm meiro-btn" href="/" title="meiro.kr 처음으로">MEIRO</a>
        <span>${esc(name)}</span>
        <a class="btn ghost sm" href="/saytqtul/">${icon("diary")}일기장</a>
        ${themeButton()}
        <button class="btn ghost sm" type="button" data-act="logout">로그아웃</button>
      </div>
    </header>
    <nav class="tabs" aria-label="노트 메뉴">${TABS.map((t) => `<a href="#${t.path}" ${t.path === current ? 'aria-current="page"' : ""}>${icon(t.icon)}${t.label}</a>`).join("")}</nav>
    ${inner}
  </main>`;
}
function bindShell() {
  $('[data-act="logout"]')?.addEventListener("click", async () => { await sb.auth.signOut(); go("#/login", true); });
}
const waiting = () => `<div class="paper notice"><h2>승인을 기다리고 있어요</h2><p>관리자가 가입을 승인하면 글을 쓸 수 있어요.</p></div>`;
const loading = () => '<p class="muted">불러오는 중…</p>';

/* ---------- 데이터 ---------- */
async function loadFolders() {
  const { data, error } = await sb.from("writing_folders").select("*").order("sort").order("created_at");
  if (error) throw error;
  state.folders = (data ?? []).map((f) => ({ ...f, color: safeColor(f.color) }));
  return state.folders;
}
async function loadPosts() {
  const { data, error } = await sb.from("writing_posts")
    .select("id, folder_id, written_on, title, purpose, content, photos, status, published_at, updated_at")
    .eq("user_id", state.user.id).order("written_on", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((p) => ({ ...p, purpose: p.purpose ?? "", photos: p.photos ?? [] }));
}
const folderOf = (id) => state.folders.find((f) => f.id === id) ?? null;
const folderChip = (id) => {
  const f = folderOf(id);
  return f ? `<a class="folder-chip" href="#/?folder=${f.id}"><i class="dot" style="background:${f.color}"></i>${esc(f.name)}</a>` : "";
};
const statsText = (s) => `${num(s.chars)}자 · 공백 제외 ${num(s.noSpace)}자 · ${num(s.words)}단어`;

/* ---------- 로그인 (일기장과 같은 계정) ---------- */
function renderLogin() {
  document.title = "로그인 — MEIRONOTE";
  let mode = "in";
  const draw = () => {
    app.innerHTML = `<a class="home-link" href="/" title="meiro.kr 처음으로">← MEIRO</a>${themeButton("corner")}<main class="auth"><div class="paper">
      <h1 class="note-mark" style="text-align:center"><a href="#/">${brand()}</a></h1>
      <p class="muted small" style="text-align:center;margin:8px 0 0">${mode === "in" ? "일기장과 같은 계정으로 들어가요" : "새 계정을 만들어요"}</p>
      <form id="auth-form">
        ${mode === "up" ? '<label class="field">닉네임<input class="input" id="nick" required autocomplete="nickname"></label>' : ""}
        <label class="field">이메일<input class="input" id="email" type="email" required autocomplete="email"></label>
        <label class="field">비밀번호<input class="input" id="pw" type="password" minlength="6" required autocomplete="${mode === "in" ? "current-password" : "new-password"}"></label>
        <button class="btn primary" type="submit">${mode === "in" ? "로그인" : "가입하기"}</button>
      </form>
      <button class="switch" type="button" id="switch">${mode === "in" ? "계정이 없나요? 가입하기" : "이미 계정이 있나요? 로그인"}</button>
      ${mode === "in" ? '<p class="find-links"><a href="/saytqtul/#/find-id">아이디(이메일) 찾기</a><span aria-hidden="true">·</span><a href="/saytqtul/#/forgot">비밀번호 찾기</a></p>' : ""}
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
        else if (!data.session) $(".auth-result")?.remove(), $("#auth-form").insertAdjacentHTML("afterend", '<p class="auth-result">확인 메일을 보냈어요. 메일의 링크를 누르면 가입이 완료돼요. 메일이 안 보이면 <b>스팸함</b>도 확인해 주세요.</p>');
      }
      btn.disabled = false;
    };
  };
  draw();
}

/* ---------- 글 목록 (폴더별) ---------- */
async function renderList(params) {
  document.title = "MEIRONOTE";
  app.innerHTML = shell("/", loading());
  bindShell();
  const [posts] = await Promise.all([loadPosts(), loadFolders()]);
  const folder = params.get("folder") ?? "";
  const count = (key) => filterPosts(posts, { folder: key }).length;
  const current = folder === "drafts" ? "임시저장 중인 글" : folder === "none" ? "폴더 없음" : folderOf(folder)?.name ?? "모든 글";
  const shown = filterPosts(posts, { folder: folderOf(folder) || ["drafts", "none"].includes(folder) ? folder : "" });
  const item = (key, name, dot = "") => `<li><a href="#/${key ? `?folder=${key}` : ""}" ${key === folder || (!key && !folderOf(folder) && !["drafts", "none"].includes(folder)) ? 'aria-current="page"' : ""}>
    ${dot ? `<i class="dot" style="background:${dot}"></i>` : icon(key === "drafts" ? "pen" : "folder")}<span>${esc(name)}</span><small>${count(key)}</small></a></li>`;
  $("main").lastElementChild.remove();
  $("main").insertAdjacentHTML("beforeend", `<div class="note-layout">
    <aside class="paper folders" aria-label="폴더">
      <ul>${item("", "모든 글")}${item("drafts", "임시저장 중")}</ul>
      <p class="folders-head"><span>폴더</span><button class="btn ghost sm" type="button" id="folder-manage">관리</button></p>
      <ul>${state.folders.map((f) => item(f.id, f.name, f.color)).join("")}${item("none", "폴더 없음", "#adb5bd")}</ul>
    </aside>
    <section class="list-main">
      <div class="page-head"><h2 class="page-title" style="margin:0">${esc(current)} <span class="muted small">${shown.length}편</span></h2>
        <a class="btn primary" href="#/write${folderOf(folder) ? `?folder=${folder}` : ""}">${icon("pen")}새 글</a></div>
      ${postList(shown)}
    </section>
  </div>`);
  $("#folder-manage").onclick = () => folderManager(() => route());
  loadThumbs();
}

function postList(posts) {
  if (!posts.length) return '<p class="empty">글이 없어요.</p>';
  return `<ol class="list">${posts.map((p) => {
    const href = p.status === "draft" ? `#/edit/${p.id}` : `#/post/${p.id}`;
    const first = p.photos[0];
    return `<li class="${first ? "has-thumb" : ""}">
      ${first ? `<a class="thumb" href="${href}" data-p="${esc(first)}" aria-label="${esc(p.title || "제목 없음")} 열기"></a>` : ""}
      <div class="row"><time>${p.written_on.replaceAll("-", ".")}</time>${p.status === "draft" ? '<span class="badge">임시저장</span>' : ""}${folderChip(p.folder_id)}</div>
      <a class="t" href="${href}">${esc(p.title || "제목 없음")}</a>
      ${p.purpose ? `<p class="purpose"><span>목적</span>${esc(p.purpose)}</p>` : ""}
      <p class="excerpt">${esc(plainText(p.content))}</p>
      <div class="tags"><span class="muted">${statsText(textStats(p.content))}</span></div>
    </li>`;
  }).join("")}</ol>`;
}

/** 목록의 첫 사진 자리에 실제 사진을 채움 */
async function loadThumbs() {
  const boxes = $$(".thumb[data-p]");
  if (!boxes.length) return;
  const { data } = await sb.storage.from(BUCKET).createSignedUrls(boxes.map((b) => b.dataset.p), 3600);
  const urls = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
  for (const b of boxes) {
    const url = urls.get(b.dataset.p);
    if (url) b.innerHTML = `<img src="${esc(url)}" alt="" loading="lazy">`;
  }
}

/* ---------- 폴더 관리 창 ---------- */
function folderManager(onDone) {
  const dlg = document.createElement("dialog");
  dlg.innerHTML = `<h2>폴더 관리</h2>
    <button class="btn ghost sm dialog-close" type="button" aria-label="닫기">닫기</button>
    <p class="muted small" style="margin:-8px 0 12px">폴더를 지우면 안에 있던 글은 '폴더 없음'으로 옮겨져요.</p>
    <ul class="label-list"></ul>
    <form class="label-add"><input type="color" value="#0031b0" aria-label="새 폴더 색"><input class="input" placeholder="예: 에세이" aria-label="새 폴더 이름"><button class="btn primary" type="submit">추가</button></form>`;
  document.body.append(dlg);
  const list = $(".label-list", dlg);
  const draw = () => {
    list.innerHTML = state.folders.length ? state.folders.map((f, i) => `<li data-id="${f.id}">
        <input type="color" value="${f.color}" aria-label="${esc(f.name)} 색">
        <input class="input" value="${esc(f.name)}" aria-label="폴더 이름">
        <button class="btn ghost sm" type="button" data-move="-1" ${i ? "" : "disabled"} aria-label="위로">↑</button>
        <button class="btn ghost sm danger" type="button" data-del>삭제</button></li>`).join("")
      : '<li class="empty-hint">아직 폴더가 없어요.</li>';
    $$("li[data-id]", list).forEach((li) => {
      const id = li.dataset.id, f = folderOf(id);
      const [color, name] = $$("input", li);
      color.onchange = () => update(id, { color: color.value });
      name.onblur = () => { const v = name.value.trim(); if (v && v !== f.name) update(id, { name: v }); };
      $("[data-del]", li).onclick = async () => {
        if (!confirm(`'${f.name}' 폴더를 지울까요? 안의 글은 지워지지 않고 '폴더 없음'으로 옮겨져요.`)) return;
        await sb.from("writing_folders").delete().eq("id", id);
        await loadFolders(); draw();
      };
      $("[data-move]", li).onclick = async () => {
        const i = state.folders.findIndex((x) => x.id === id);
        const order = [...state.folders];
        [order[i - 1], order[i]] = [order[i], order[i - 1]];
        await Promise.all(order.map((x, n) => sb.from("writing_folders").update({ sort: n }).eq("id", x.id)));
        await loadFolders(); draw();
      };
    });
  };
  const update = async (id, patch) => { await sb.from("writing_folders").update(patch).eq("id", id); await loadFolders(); draw(); };
  $(".label-add", dlg).onsubmit = async (e) => {
    e.preventDefault();
    const [color, name] = $$(".label-add input", dlg);
    if (!name.value.trim()) return;
    const { error } = await sb.from("writing_folders").insert({ name: name.value.trim(), color: color.value, sort: state.folders.length });
    if (error) { toast("추가하지 못했어요.", "error"); return; }
    name.value = "";
    await loadFolders(); draw();
  };
  $(".dialog-close", dlg).onclick = () => dlg.close();
  dlg.addEventListener("close", () => { dlg.remove(); onDone(); });
  draw();
  dlg.showModal();
}

/* ---------- 사진 (일기장과 같은 모양) ---------- */
async function fillPhotos(el, photos) {
  if (!photos.length) return;
  const { data } = await sb.storage.from(BUCKET).createSignedUrls(photos, 3600);
  for (const d of data ?? []) {
    const box = $$(".photo", el).find((x) => x.dataset.p === d.path);
    if (box && d.signedUrl && !box.querySelector("img")) box.insertAdjacentHTML("afterbegin", `<a href="${esc(d.signedUrl)}" target="_blank" rel="noreferrer"><img src="${esc(d.signedUrl)}" alt="첨부 사진" loading="lazy"></a>`);
  }
}

/* ---------- 글 읽기 ---------- */
async function renderPost(id) {
  app.innerHTML = shell("", loading());
  bindShell();
  const [{ data: post, error }, { data: versions }] = await Promise.all([
    sb.from("writing_posts").select("*").eq("id", id).maybeSingle(),
    sb.from("writing_versions").select("id, kind, updated_at").eq("post_id", id),
    loadFolders(),
  ]);
  if (error) throw error;
  if (!post) { $("main").lastElementChild.outerHTML = '<div class="paper notice"><h2>글을 찾을 수 없어요</h2><p><a href="#/">목록으로</a></p></div>'; return; }
  if (post.status === "draft") return go(`#/edit/${id}`, true);
  document.title = `${post.title || "제목 없음"} — MEIRONOTE`;
  const f = postFields(post);
  const s = textStats(f.content);
  // 올린 뒤에 고친 내용(자동 저장·임시저장)이 남아 있으면 알려 줌
  const pending = (versions ?? []).filter((v) => v.kind !== "publish" && Date.parse(v.updated_at) > Date.parse(post.updated_at))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  $("main").lastElementChild.outerHTML = `<section class="paper entry">
      ${pending ? `<p class="pending">올리지 않은 고친 내용이 있어요 (${kstStamp(pending.updated_at)} ${KIND_NAME[pending.kind]}) <a class="btn outline sm" href="#/edit/${id}">이어 쓰기</a></p>` : ""}
      <div class="meta-row"><p class="date">${longDate(f.written_on)}</p>${folderChip(f.folder_id)}</div>
      <div class="read-head">
        <h2>${esc(f.title || "제목 없음")}</h2>
        <div class="read-acts">
          <a class="btn outline sm" href="#/edit/${id}">수정</a>
          <button class="btn ghost sm" type="button" id="history">${icon("history")}버전 기록</button>
          <button class="btn ghost sm danger" type="button" id="del">삭제</button>
        </div>
      </div>
      ${f.purpose ? `<p class="purpose read"><span>목적</span>${esc(f.purpose)}</p>` : ""}
      ${f.photos.length ? `<div class="photos" style="margin-top:24px">${f.photos.map((p) => `<div class="photo" data-p="${esc(p)}"></div>`).join("")}</div>` : ""}
      <div class="content lined">${toHtml(f.content)}</div>
      <p class="count-line">${statsText(s)} · ${kstStamp(post.published_at)} 올림${post.updated_at !== post.published_at ? ` · ${kstStamp(post.updated_at)} 고침` : ""}</p>
      <div class="comments" id="comments"></div>
    </section>`;
  fillPhotos($("main"), f.photos);
  $("#history").onclick = () => versionsDialog(id, (v) => go(`#/edit/${id}?v=${v.id}`));
  $("#del").onclick = () => removePost(post);
  commentsBlock($("#comments"), id);
}

async function removePost(post) {
  if (!confirm("이 글을 삭제할까요? 버전 기록, 댓글, 사진도 함께 지워져요.")) return false;
  const { data: versions } = await sb.from("writing_versions").select("fields").eq("post_id", post.id);
  const photos = [...new Set([...(post.photos ?? []), ...(versions ?? []).flatMap((v) => postFields(v.fields).photos)])];
  const { error } = await sb.from("writing_posts").delete().eq("id", post.id);
  if (error) { toast("삭제하지 못했어요.", "error"); return false; }
  if (photos.length) await sb.storage.from(BUCKET).remove(photos);
  try { localStorage.removeItem(draftKey(state.user.id, post.id)); } catch { /* 없어도 됨 */ }
  toast("삭제했어요");
  go("#/", true);
  return true;
}

async function commentsBlock(el, postId) {
  const { data } = await sb.from("writing_comments").select("*").eq("post_id", postId).order("created_at");
  const list = data ?? [];
  const who = state.profile?.nickname || "나";
  el.innerHTML = `<h3>댓글 ${list.length}</h3>
    <ul>${list.map((c) => `<li><div class="meta"><span>${esc(who)} · ${kstStamp(c.created_at)}</span><button type="button" data-c="${c.id}">삭제</button></div><p>${esc(c.content)}</p></li>`).join("")}</ul>
    <form id="comment-form"><input class="input" id="comment" placeholder="댓글 달기" aria-label="댓글"><button class="btn primary" type="submit">등록</button></form>`;
  $$("[data-c]", el).forEach((b) => b.onclick = async () => { await sb.from("writing_comments").delete().eq("id", b.dataset.c); commentsBlock(el, postId); });
  $("#comment-form", el).onsubmit = async (e) => {
    e.preventDefault();
    const text = $("#comment", el).value;
    if (!text.trim()) return;
    const { error } = await sb.from("writing_comments").insert({ post_id: postId, content: text });
    if (error) { toast("댓글을 달지 못했어요.", "error"); return; }
    commentsBlock(el, postId);
  };
}

/* ---------- 버전 기록 창 ---------- */
async function versionsDialog(postId, onLoad) {
  const { data, error } = await sb.from("writing_versions").select("*").eq("post_id", postId).order("updated_at", { ascending: false });
  if (error) { toast("버전 기록을 불러오지 못했어요.", "error"); return; }
  const list = data ?? [];
  const dlg = document.createElement("dialog");
  dlg.className = "versions";
  dlg.innerHTML = `<h2>버전 기록</h2>
    <button class="btn ghost sm dialog-close" type="button" aria-label="닫기">닫기</button>
    <p class="muted small" style="margin:-8px 0 12px">자동 저장은 고치는 동안 계속 덮어써지고, 임시저장과 올림은 누를 때마다 하나씩 남아요.</p>
    ${list.length ? `<div class="v-layout"><ol class="v-list">${list.map((v, i) => {
      const f = postFields(v.fields);
      return `<li><button type="button" data-v="${v.id}" aria-pressed="${i === 0}">
        <span class="v-top"><span class="badge ${v.kind}">${KIND_NAME[v.kind]}</span><time>${kstStamp(v.updated_at)}</time></span>
        <span class="v-title">${esc(f.title || "제목 없음")}</span><span class="muted small">${num(textStats(f.content).chars)}자</span></button></li>`;
    }).join("")}</ol><div class="v-preview" id="v-preview"></div></div>` : '<p class="empty" style="padding:32px 0">아직 저장된 버전이 없어요.</p>'}`;
  document.body.append(dlg);
  const show = (id) => {
    const v = list.find((x) => x.id === id);
    const f = postFields(v.fields);
    $$("[data-v]", dlg).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === id)));
    $("#v-preview", dlg).innerHTML = `<div class="v-head"><div><p class="muted small" style="margin:0">${KIND_NAME[v.kind]} · ${kstStamp(v.updated_at)} · ${longDate(f.written_on)}${folderOf(f.folder_id) ? ` · ${esc(folderOf(f.folder_id).name)}` : ""}</p>
        <h3>${esc(f.title || "제목 없음")}</h3>${f.purpose ? `<p class="purpose"><span>목적</span>${esc(f.purpose)}</p>` : ""}</div><button class="btn primary sm" type="button" id="v-load">이 버전 불러오기</button></div>
      <div class="content lined">${toHtml(f.content)}</div><p class="count-line">${statsText(textStats(f.content))}${f.photos.length ? ` · 사진 ${f.photos.length}장` : ""}</p>`;
    $("#v-load", dlg).onclick = () => { dlg.close(); onLoad(v); };
  };
  $$("[data-v]", dlg).forEach((b) => b.onclick = () => show(b.dataset.v));
  if (list.length) show(list[0].id);
  $(".dialog-close", dlg).onclick = () => dlg.close();
  dlg.addEventListener("close", () => dlg.remove());
  dlg.showModal();
}

/* ---------- 쓰기 / 고치기: 자동 저장, 임시저장, 올리기 ---------- */
async function renderEdit(id, params) {
  app.innerHTML = shell(id ? "" : "/write", loading());
  bindShell();
  const uid = state.user.id;
  let post = null, versions = [];
  if (id) {
    const [p, v] = await Promise.all([
      sb.from("writing_posts").select("*").eq("id", id).maybeSingle(),
      sb.from("writing_versions").select("*").eq("post_id", id),
    ]);
    if (p.error) throw p.error;
    post = p.data;
    if (!post) { $("main").lastElementChild.outerHTML = '<div class="paper notice"><h2>글을 찾을 수 없어요</h2><p><a href="#/">목록으로</a></p></div>'; return; }
    versions = v.data ?? [];
  }
  await loadFolders();
  document.title = `${post ? "고치기" : "새 글"} — MEIRONOTE`;

  // 이어 쓸 내용: 버전 기록에서 고른 것 > 가장 최근 자동 저장·임시저장·이 기기 임시저장 > 글
  let key = draftKey(uid, id);
  let local = null;
  try { local = readLocalDraft(localStorage.getItem(key)); } catch { /* 임시저장은 선택 사항 */ }
  const picked = params.get("v") && versions.find((v) => v.id === params.get("v"));
  const resume = picked ? null : pickResume(post, versions, local);
  const startFolder = folderOf(params.get("folder")) ? params.get("folder") : null;
  let f = picked ? postFields(picked.fields) : resume ? resume.fields : postFields(post ?? { folder_id: startFolder, written_on: kstDay() });
  let message = picked ? `${KIND_NAME[picked.kind]} 버전(${kstStamp(picked.updated_at)})을 불러왔어요`
    : resume ? `${resume.source === "local" ? "이 기기에 남은 내용" : "자동 저장된 내용"}(${hhmm(resume.at)})을 불러왔어요` : "";

  let autoId = null; // 이번에 고치는 동안 덮어쓰는 자동 저장 버전
  let localTimer = null, autoTimer = null, localDirty = false, serverDirty = !!(picked || resume);
  let queue = Promise.resolve();
  const setStatus = (t) => { const el = $("#save-status"); if (el) el.textContent = t; };
  const drawCounts = () => { const el = $("#counts"); if (el) el.textContent = statsText(textStats(f.content)); };

  const flushLocal = () => {
    if (!localDirty) return;
    try { localStorage.setItem(key, JSON.stringify({ updatedAt: Date.now(), fields: f })); localDirty = false; }
    catch { setStatus("이 기기에는 저장할 수 없어요. 자동 저장은 계속돼요."); }
  };
  const clearLocal = () => { clearTimeout(localTimer); localDirty = false; try { localStorage.removeItem(key); } catch { /* 없어도 됨 */ } };

  // 새 글은 처음 저장할 때 임시저장 상태로 만들어 둠
  async function ensurePost() {
    if (post) return post;
    const { data, error } = await sb.from("writing_posts").insert({ ...f, status: "draft" }).select().single();
    if (error) throw error;
    post = data;
    const oldKey = key;
    key = draftKey(uid, post.id);
    try { localStorage.removeItem(oldKey); } catch { /* 없어도 됨 */ }
    history.replaceState(null, "", `#/edit/${post.id}`);
    $("#history-btn")?.removeAttribute("hidden");
    return post;
  }
  // 임시저장 상태의 글은 글 자체도 최신 내용으로 (목록에 보이게)
  async function syncDraftPost(now) {
    if (post.status !== "draft") return;
    const { error } = await sb.from("writing_posts").update({ ...f, updated_at: now }).eq("id", post.id);
    if (error) throw error;
    post = { ...post, ...f, updated_at: now };
  }
  const autoSave = () => (queue = queue.then(async () => {
    if (!serverDirty || (!post && isBlank(f))) return;
    serverDirty = false;
    const snapshot = structuredClone(f);
    try {
      await ensurePost();
      const now = new Date().toISOString();
      if (autoId) {
        const { error } = await sb.from("writing_versions").update({ fields: snapshot, updated_at: now }).eq("id", autoId);
        if (error) throw error;
      } else {
        const { data, error } = await sb.from("writing_versions").insert({ post_id: post.id, kind: "auto", fields: snapshot }).select().single();
        if (error) throw error;
        autoId = data.id;
      }
      await syncDraftPost(now);
      setStatus(`자동 저장됨 ${hhmm(Date.now())}`);
    } catch {
      serverDirty = true;
      setStatus("자동 저장하지 못했어요. 이 기기에는 남아 있어요.");
    }
  }));
  const changed = () => {
    localDirty = true; serverDirty = true;
    setStatus("고치는 중…");
    drawCounts();
    clearTimeout(localTimer); localTimer = setTimeout(flushLocal, 600);
    clearTimeout(autoTimer); autoTimer = setTimeout(autoSave, AUTO_MS);
  };
  leaveHook = () => { clearTimeout(autoTimer); flushLocal(); autoSave(); };

  async function saveVersion(kind) {
    clearTimeout(autoTimer);
    serverDirty = false;
    await queue;
    await ensurePost();
    const { error } = await sb.from("writing_versions").insert({ post_id: post.id, kind, fields: structuredClone(f) });
    if (error) throw error;
    autoId = null; // 다음 자동 저장은 새 버전으로
  }
  async function tempSave() {
    const btn = $("#temp");
    btn.disabled = true;
    try {
      await saveVersion("manual");
      await syncDraftPost(new Date().toISOString());
      clearLocal();
      setStatus(`임시저장함 ${hhmm(Date.now())}`);
      toast("임시저장했어요");
    } catch { toast("임시저장하지 못했어요.", "error"); serverDirty = true; }
    btn.disabled = false;
  }
  async function publish() {
    if (!plainText(f.content).trim()) { toast("내용을 적어 주세요.", "error"); return; }
    const btn = $("#publish");
    btn.disabled = true; btn.textContent = "올리는 중…";
    try {
      await saveVersion("publish");
      const now = new Date().toISOString();
      const { error } = await sb.from("writing_posts").update({ ...f, status: "published", published_at: post.published_at ?? now, updated_at: now }).eq("id", post.id);
      if (error) throw error;
      clearLocal();
      leaveHook = null;
      toast("올렸어요");
      go(`#/post/${post.id}`, true);
    } catch { btn.disabled = false; btn.textContent = post?.status === "published" ? "고친 내용 올리기" : "올리기"; toast("올리지 못했어요.", "error"); serverDirty = true; }
  }

  const draw = () => {
    const published = post?.status === "published";
    $("main").lastElementChild.outerHTML = `<section class="paper entry editing">
      <div class="save-bar">
        <p class="status" id="save-status">${message || (published ? "올린 글을 고치는 중이에요. 올리기 전까지는 버전 기록에만 남아요." : "입력하면 자동으로 저장돼요")}</p>
        <p class="status counts" id="counts"></p>
      </div>
      <div class="stack">
        <div class="meta-fields">
          <label class="field">날짜<input class="input" type="date" id="day" value="${f.written_on}" required></label>
          <label class="field">폴더<select class="input" id="folder"><option value="">폴더 없음</option>${state.folders.map((x) => `<option value="${x.id}" ${x.id === f.folder_id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}<option value="+">+ 새 폴더…</option></select></label>
        </div>
        <input class="input title-input" id="title" placeholder="제목" value="${esc(f.title)}" aria-label="제목">
        <label class="field purpose-field">목적<input class="input" id="purpose" placeholder="이 글을 쓰는 목적 (예: 수업 과제 제출용, 공모전 초안)" value="${esc(f.purpose)}"></label>
        <div id="photos"></div>
        <div id="content"></div>
        <div class="actions">
          <button class="btn ghost" type="button" id="history-btn" ${post ? "" : "hidden"}>${icon("history")}버전 기록</button>
          <span class="spacer"></span>
          ${post ? '<button class="btn ghost danger" type="button" id="del">삭제</button>' : ""}
          <a class="btn ghost" href="${published ? `#/post/${post.id}` : "#/"}">나가기</a>
          <button class="btn outline" type="button" id="temp">임시저장</button>
          <button class="btn primary" type="button" id="publish">${published ? "고친 내용 올리기" : "올리기"}</button>
        </div>
      </div>
    </section>`;
    drawCounts();
    $("#day").onchange = (e) => { if (isDay(e.target.value)) { f.written_on = e.target.value; changed(); } };
    const onFolder = async (e) => {
      if (e.target.value !== "+") { f.folder_id = e.target.value || null; changed(); return; }
      const name = prompt("새 폴더 이름");
      if (name?.trim()) {
        const { data, error } = await sb.from("writing_folders").insert({ name: name.trim(), sort: state.folders.length }).select().single();
        if (error) toast("폴더를 만들지 못했어요.", "error");
        else { await loadFolders(); f.folder_id = data.id; changed(); }
      }
      e.target.outerHTML = `<select class="input" id="folder"><option value="">폴더 없음</option>${state.folders.map((x) => `<option value="${x.id}" ${x.id === f.folder_id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}<option value="+">+ 새 폴더…</option></select>`;
      $("#folder").onchange = onFolder;
    };
    $("#folder").onchange = onFolder;
    $("#title").oninput = (e) => { f.title = e.target.value; changed(); };
    $("#purpose").oninput = (e) => { f.purpose = e.target.value; changed(); };
    richEditor($("#content"), f.content, (v) => { f.content = v; changed(); });
    photosEditor($("#photos"));
    $("#history-btn").onclick = async () => {
      await autoSave();
      if (post) versionsDialog(post.id, (v) => {
        f = postFields(v.fields);
        message = `${KIND_NAME[v.kind]} 버전(${kstStamp(v.updated_at)})을 불러왔어요`;
        draw(); changed(); setStatus(message);
      });
    };
    $("#temp").onclick = tempSave;
    $("#publish").onclick = publish;
    $("#del")?.addEventListener("click", async () => { clearTimeout(autoTimer); serverDirty = false; await queue; if (await removePost(post)) leaveHook = null; });
  };

  // 사진을 빼도 파일은 남겨 둠 (예전 버전을 불러올 때 필요). 글을 지우면 함께 지워짐
  function photosEditor(el) {
    el.innerHTML = `<div class="section-head"><h3>사진</h3><input type="file" accept="image/*" multiple hidden id="file"><button class="btn outline sm" type="button" id="add-photo">사진 추가</button></div>
      <div class="photos">${f.photos.map((p) => `<div class="photo" data-p="${esc(p)}"><button class="btn sm danger" type="button">빼기</button></div>`).join("")}</div>`;
    const input = $("#file", el), btn = $("#add-photo", el);
    btn.onclick = () => input.click();
    input.onchange = async () => {
      btn.disabled = true; btn.textContent = "올리는 중…";
      for (const file of input.files) {
        const path = `${uid}/note/${crypto.randomUUID()}.${file.name.split(".").pop() || "jpg"}`;
        const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type });
        if (error) toast(`${file.name}을(를) 올리지 못했어요.`, "error"); else f.photos = [...f.photos, path];
      }
      changed(); photosEditor(el);
    };
    $$(".photo .btn", el).forEach((b) => b.onclick = () => {
      f.photos = f.photos.filter((x) => x !== b.parentElement.dataset.p);
      changed(); photosEditor(el);
    });
    fillPhotos(el, f.photos);
  }

  draw();
  if (picked || resume) { localDirty = true; flushLocal(); clearTimeout(autoTimer); autoTimer = setTimeout(autoSave, AUTO_MS); }
}

/* ---------- 월간 리포트 ---------- */
async function renderReports(params) {
  document.title = "월간 리포트 — MEIRONOTE";
  app.innerHTML = shell("/reports", loading());
  bindShell();
  const [posts] = await Promise.all([loadPosts(), loadFolders()]);
  let month = isMonth(params.get("month")) ? params.get("month") : kstDay().slice(0, 7);
  $("main").lastElementChild.outerHTML = `<div class="page-head">
      <div class="month-nav"><button class="btn outline sm" type="button" data-m="-1" aria-label="이전 달">${icon("left")}</button>
        <input class="input" type="month" id="month" value="${month}" aria-label="리포트 월">
        <button class="btn outline sm" type="button" data-m="1" aria-label="다음 달">${icon("right")}</button></div>
      <p class="muted small" style="margin:0">올린 글만 세요. 임시저장 중인 글은 빠져요.</p>
    </div><div class="report"></div>`;
  const draw = () => {
    history.replaceState(null, "", `#/reports?month=${month}`);
    $("#month").value = month;
    const r = monthReport(posts, month, state.folders);
    const prev = monthReport(posts, shiftMonth(month, -1), state.folders);
    const diff = (a, b, unit) => (b ? `<span class="muted small">지난달보다 ${a >= b ? "+" : "−"}${num(Math.abs(a - b))}${unit}</span>` : "");
    $(".report").innerHTML = `
      <div class="stats four">
        <div><span class="muted small">올린 글</span><b>${num(r.count)}<small>편</small></b>${diff(r.count, prev.count, "편")}</div>
        <div><span class="muted small">글자 수 (공백 포함)</span><b>${num(r.chars)}<small>자</small></b>${diff(r.chars, prev.chars, "자")}</div>
        <div><span class="muted small">글자 수 (공백 제외)</span><b>${num(r.noSpace)}<small>자</small></b></div>
        <div><span class="muted small">단어 수</span><b>${num(r.words)}<small>단어</small></b>${diff(r.words, prev.words, "단어")}</div>
      </div>
      <p class="muted small summary-line">${r.count ? `${r.days}일 동안 썼고, 한 편에 평균 ${num(r.average)}자예요.${r.longest ? ` 가장 긴 글은 <a href="#/post/${r.longest.id}">${esc(r.longest.title || "제목 없음")}</a> (${num(r.longest.stats.chars)}자)` : ""}` : "이 달에 올린 글이 없어요."}</p>
      ${r.count ? `<section class="report-section"><h2 style="font-size:20px">날짜별 글자 수</h2>${dayChart(r)}</section>
      <section class="report-section"><h2 style="font-size:20px">폴더별</h2>
        <ul class="bars">${r.byFolder.map((g) => `<li><div class="lab"><span style="font-weight:600;display:inline-flex;align-items:center;gap:8px"><i class="dot" style="background:${g.color}"></i>${esc(g.name)}</span><span class="muted">${g.count}편 · ${num(g.chars)}자</span></div>
          <div class="track"><span style="width:${r.chars ? g.chars / r.chars * 100 : 0}%;background:${g.color}"></span></div></li>`).join("")}</ul></section>
      <section class="report-section"><h2 style="font-size:20px">올린 글 ${r.count}편</h2>
        <div class="table-wrap"><table class="post-table"><thead><tr><th>날짜</th><th>제목</th><th>공백 포함</th><th>공백 제외</th><th>단어</th></tr></thead>
        <tbody>${[...r.posts].reverse().map((p) => `<tr><td>${p.written_on.slice(5).replace("-", ".")}</td><td><a href="#/post/${p.id}">${esc(p.title || "제목 없음")}</a></td><td>${num(p.stats.chars)}</td><td>${num(p.stats.noSpace)}</td><td>${num(p.stats.words)}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td></td><td>합계</td><td>${num(r.chars)}</td><td>${num(r.noSpace)}</td><td>${num(r.words)}</td></tr></tfoot></table></div></section>` : ""}`;
  };
  $("#month").onchange = (e) => { if (isMonth(e.target.value)) { month = e.target.value; draw(); } };
  $$("[data-m]").forEach((b) => b.onclick = () => { month = shiftMonth(month, Number(b.dataset.m)); draw(); });
  draw();
}

/** 날짜별 글자 수 막대 */
function dayChart(r) {
  const W = 960, H = 280, L = 48, R = 8, T = 12, B = 26;
  const max = Math.max(...r.byDay.map((d) => d.chars), 1);
  const nice = (() => { const p = 10 ** Math.floor(Math.log10(max)); return Math.ceil(max / p) * p; })();
  const n = r.byDay.length, bw = (W - L - R) / n;
  const y = (v) => T + (1 - v / nice) * (H - T - B);
  const ticks = [0, nice / 2, nice];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="날짜별 글자 수 그래프">
    ${ticks.map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${num(t)}</text>`).join("")}
    ${r.byDay.map((d, i) => `${d.chars ? `<rect class="bar" x="${L + i * bw + bw * 0.18}" y="${y(d.chars)}" width="${bw * 0.64}" height="${y(0) - y(d.chars)}" rx="2"><title>${Number(d.day.slice(8))}일 · ${d.count}편 · ${num(d.chars)}자</title></rect>` : ""}
      ${i === 0 || (i + 1) % 5 === 0 ? `<text x="${L + i * bw + bw / 2}" y="${H - 8}" text-anchor="middle">${i + 1}일</text>` : ""}`).join("")}
  </svg>`;
}

/* ---------- 검색 ---------- */
async function renderSearch() {
  document.title = "검색 — MEIRONOTE";
  app.innerHTML = shell("/search", loading());
  bindShell();
  const [posts] = await Promise.all([loadPosts(), loadFolders()]);
  $("main").lastElementChild.outerHTML = `
    <input class="input" id="q" type="search" placeholder="제목, 목적, 내용 검색" aria-label="글 검색">
    <div class="filters">
      <label class="field">시작일<input class="input" type="date" id="from"></label>
      <label class="field">종료일<input class="input" type="date" id="to"></label>
      <label class="field">폴더<select class="input" id="folder"><option value="">모든 폴더</option>${state.folders.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("")}<option value="none">폴더 없음</option></select></label>
    </div>
    <label class="check"><input type="checkbox" id="drafts" checked> 임시저장 중인 글도 찾기</label>
    <p class="muted small" id="count" style="margin-top:20px"></p><div id="results"></div>`;
  const draw = () => {
    const found = filterPosts(posts, { q: $("#q").value, from: $("#from").value, to: $("#to").value, folder: $("#folder").value, drafts: $("#drafts").checked });
    $("#count").textContent = `검색 결과 ${found.length}개`;
    $("#results").innerHTML = postList(found);
    loadThumbs();
  };
  ["q", "from", "to", "folder", "drafts"].forEach((id) => $(`#${id}`).addEventListener("input", draw));
  draw();
}

/* ---------- 라우터 ---------- */
async function route() {
  leaveHook?.();
  leaveHook = null;
  $$("dialog").forEach((d) => d.remove());
  const { path, parts, params } = parseHash();
  if (path === "/login") return state.user ? go("#/", true) : renderLogin();
  if (!state.user) return go("#/login", true);
  if (!state.profile) {
    const { data } = await sb.from("profiles").select("nickname, approved").eq("id", state.user.id).maybeSingle();
    state.profile = data ?? { nickname: "", approved: false };
  }
  if (!state.profile.approved) { app.innerHTML = shell("/", waiting()); bindShell(); return; }
  try {
    if (parts[0] === "write") return await renderEdit(null, params);
    if (parts[0] === "edit" && parts[1]) return await renderEdit(parts[1], params);
    if (parts[0] === "post" && parts[1]) return await renderPost(parts[1]);
    if (parts[0] === "reports") return await renderReports(params);
    if (parts[0] === "search") return await renderSearch();
    return await renderList(params);
  } catch {
    app.innerHTML = shell("/", '<div class="paper notice"><h2>불러오지 못했어요</h2><p>잠시 뒤 새로고침해 주세요. 계속되면 데이터베이스 설정(note.sql)을 확인해 주세요.</p></div>');
    bindShell();
  }
}

async function start() {
  if ((!SUPABASE_URL || !SUPABASE_ANON_KEY) && !window.__NOTE_TEST_CLIENT__) {
    app.innerHTML = '<main class="auth"><div class="paper notice"><h2>연결 준비 중</h2><p>js/config.js에 Supabase 주소와 키를 넣어 주세요.</p></div></main>';
    return;
  }
  sb = window.__NOTE_TEST_CLIENT__ ?? (await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm"))
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
