import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js?v=202610241614";

// meiro.kr의 로그인하는 사이트(일기장, MEIROBOOK, $TDL, MEIRONOTE, MEIROPAY)가 함께 쓰는 회원 관리
const PHOTO_BUCKET = "diary-photos";
const SITES = {
  saytqtul: { name: "일기장", href: "/saytqtul/#/calendar" },
  library: { name: "MEIROBOOK", href: "/library/" },
  money: { name: "$TDL", href: "/money/" },
  note: { name: "MEIRONOTE", href: "/note/" },
  pay: { name: "MEIROPAY", href: "/pay/" },
};
const app = document.getElementById("app");
let sb = null;
const state = { user: null, profile: null, isAdmin: false };

/* ---------- 도우미 ---------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const kstDate = (iso) => {
  if (!iso) return "";
  const t = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return `${t.getUTCFullYear()}.${String(t.getUTCMonth() + 1).padStart(2, "0")}.${String(t.getUTCDate()).padStart(2, "0")}`;
};

function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), 3200);
}

const ICON = {
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M1 21a8 8 0 0 1 16 0M17 4a4 4 0 0 1 0 8M23 21a8 8 0 0 0-5-7.4"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

/* ---------- 어느 사이트에서 왔는지 (돌아가기 버튼) ---------- */
function fromSite() {
  const q = new URLSearchParams(location.search).get("from");
  try {
    if (q && SITES[q]) sessionStorage.setItem("meiro-account-from", q);
    const saved = sessionStorage.getItem("meiro-account-from");
    return SITES[saved] ? SITES[saved] : null;
  } catch { return SITES[q] ?? null; }
}

/* ---------- 주소(#/경로) ---------- */
const path = () => location.hash.replace(/^#/, "").split("?")[0] || "/";
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
function shell(current, inner, counts = {}) {
  const back = fromSite();
  const tabs = [{ path: "/", label: "내 정보", icon: "user" },
    ...(state.isAdmin ? [{ path: "/members", label: "회원 목록", icon: "users", n: counts.pending }, { path: "/feedback", label: "피드백", icon: "message", n: counts.unread }] : [])];
  return `<main class="wrap narrow">
    <header class="top">
      <h1 class="acc-mark"><a href="#/">회원 관리</a></h1>
      <div class="who">
        ${back ? `<a class="btn outline sm" href="${back.href}">${icon("left")}${esc(back.name)}</a>` : ""}
        <a class="btn ghost sm meiro-btn" href="/" title="meiro.kr 처음으로">MEIRO</a>
        ${themeButton()}
        <button class="btn ghost sm" type="button" data-act="logout">로그아웃</button>
      </div>
    </header>
    <nav class="tabs" aria-label="회원 관리 메뉴">${tabs.map((t) => `<a href="#${t.path}" ${t.path === current ? 'aria-current="page"' : ""}>${icon(t.icon)}${t.label}${t.n ? `<span class="count">${t.n}</span>` : ""}</a>`).join("")}</nav>
    ${inner}
  </main>`;
}
function bindShell() {
  $('[data-act="logout"]')?.addEventListener("click", async () => { await sb.auth.signOut(); go("#/login", true); });
}

async function loadMe() {
  const uid = state.user.id;
  const [p, r] = await Promise.all([
    sb.from("profiles").select("nickname, email, approved, created_at").eq("id", uid).maybeSingle(),
    sb.from("user_roles").select("role").eq("user_id", uid).eq("role", "admin"),
  ]);
  state.profile = p.data ?? { nickname: "", email: state.user.email, approved: false };
  state.isAdmin = (r.data ?? []).length > 0;
}

/* ---------- 로그인 (모든 사이트 같은 계정) ---------- */
function renderLogin() {
  document.title = "로그인 — 회원 관리";
  app.innerHTML = `<a class="home-link" href="/" title="meiro.kr 처음으로">← MEIRO</a>${themeButton("corner")}<main class="auth"><div class="paper">
    <h1 class="acc-mark" style="text-align:center"><a href="#/">회원 관리</a></h1>
    <p class="muted small" style="text-align:center;margin:8px 0 0">일기장과 같은 계정으로 들어가요</p>
    <form id="auth-form">
      <label class="field">이메일<input class="input" id="email" type="email" required autocomplete="email"></label>
      <label class="field">비밀번호<input class="input" id="pw" type="password" minlength="6" required autocomplete="current-password"></label>
      <button class="btn primary" type="submit">로그인</button>
    </form>
    <p class="find-links"><a href="/saytqtul/#/find-id">아이디(이메일) 찾기</a><span aria-hidden="true">·</span><a href="/saytqtul/#/forgot">비밀번호 찾기</a><span aria-hidden="true">·</span><a href="/saytqtul/#/auth">가입하기</a></p>
  </div></main>`;
  $("#auth-form").onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("#auth-form button");
    btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: $("#email").value.trim(), password: $("#pw").value });
    btn.disabled = false;
    if (error) toast("로그인에 실패했어요. 이메일과 비밀번호를 확인해 주세요.", "error");
  };
}

/* ---------- 내 정보 ---------- */
async function renderMe() {
  document.title = "내 정보 — 회원 관리";
  const { data } = await sb.auth.getUser();
  const user = data?.user ?? state.user;
  const p = state.profile;
  const counts = state.isAdmin ? await adminCounts() : {};
  app.innerHTML = shell("/", `
    <section class="paper card">
      <h2>내 계정</h2>
      <dl class="facts">
        <div><dt>닉네임</dt><dd>${esc(p.nickname || "없음")}</dd></div>
        <div><dt>이메일 (아이디)</dt><dd>${esc(user.email)}</dd></div>
        <div><dt>가입한 날</dt><dd>${kstDate(p.created_at ?? user.created_at)}</dd></div>
        <div><dt>상태</dt><dd>${p.approved ? '<span class="badge ok">승인됨</span>' : '<span class="badge wait">승인 대기</span>'}${state.isAdmin ? ' <span class="badge admin">관리자</span>' : ""}</dd></div>
      </dl>
    </section>
    <section class="paper card">
      <h2>닉네임</h2>
      <form id="nick-form" class="row-form"><input class="input" id="nick" required maxlength="40" value="${esc(p.nickname)}" aria-label="닉네임"><button class="btn primary" type="submit">바꾸기</button></form>
      <p class="hint">아이디(이메일) 찾기에 쓰여요.</p>
    </section>
    <section class="paper card">
      <h2>이메일 (로그인 아이디)</h2>
      ${user.new_email ? `<p class="notice-line">확인을 기다리는 새 이메일: <b>${esc(user.new_email)}</b> · 메일의 링크를 누르면 바뀌어요.</p>` : ""}
      <form id="email-form" class="row-form"><input class="input" id="new-email" type="email" required placeholder="새 이메일" autocomplete="email" aria-label="새 이메일"><button class="btn primary" type="submit">확인 메일 보내기</button></form>
      <p class="hint">새 이메일로 확인 메일이 가요. 메일의 링크를 <b>이 브라우저</b>에서 눌러야 바뀌어요. 메일이 안 보이면 스팸함도 확인해 주세요.</p>
    </section>
    <section class="paper card">
      <h2>비밀번호</h2>
      <form id="pw-form" class="stack-form">
        <label class="field">지금 비밀번호<input class="input" id="pw-now" type="password" required autocomplete="current-password"></label>
        <label class="field">새 비밀번호 (6자 이상)<input class="input" id="pw-new" type="password" minlength="6" required autocomplete="new-password"></label>
        <label class="field">새 비밀번호 한 번 더<input class="input" id="pw-new2" type="password" minlength="6" required autocomplete="new-password"></label>
        <div class="actions"><button class="btn primary" type="submit">비밀번호 바꾸기</button></div>
      </form>
    </section>`, counts);
  bindShell();

  $("#nick-form").onsubmit = async (e) => {
    e.preventDefault();
    const nickname = $("#nick").value.trim();
    if (!nickname) return;
    const { error } = await sb.from("profiles").update({ nickname }).eq("id", state.user.id);
    if (error) { toast("닉네임을 바꾸지 못했어요.", "error"); return; }
    state.profile.nickname = nickname;
    toast("닉네임을 바꿨어요");
    renderMe();
  };
  $("#email-form").onsubmit = async (e) => {
    e.preventDefault();
    const email = $("#new-email").value.trim().toLowerCase();
    if (!EMAIL.test(email)) { toast("이메일 모양이 아니에요.", "error"); return; }
    if (email === user.email) { toast("지금 쓰는 이메일이에요.", "error"); return; }
    const btn = $("#email-form button");
    btn.disabled = true;
    const { error } = await sb.auth.updateUser({ email }, { emailRedirectTo: `${location.origin}/account/` });
    btn.disabled = false;
    if (error) {
      toast(/already|registered|exists/i.test(error.message) ? "이미 다른 계정이 쓰는 이메일이에요."
        : /rate|seconds/i.test(error.message) ? "잠시 뒤에 다시 보내 주세요." : "확인 메일을 보내지 못했어요.", "error");
      return;
    }
    toast("확인 메일을 보냈어요. 메일함(스팸함도)을 확인해 주세요.");
    renderMe();
  };
  $("#pw-form").onsubmit = async (e) => {
    e.preventDefault();
    const now = $("#pw-now").value, next = $("#pw-new").value;
    if (next !== $("#pw-new2").value) { toast("새 비밀번호 두 개가 달라요.", "error"); return; }
    const btn = $("#pw-form button");
    btn.disabled = true;
    // 지금 비밀번호가 맞는지 먼저 확인
    const check = await sb.auth.signInWithPassword({ email: user.email, password: now });
    if (check.error) { btn.disabled = false; toast("지금 비밀번호가 맞지 않아요.", "error"); return; }
    const { error } = await sb.auth.updateUser({ password: next });
    btn.disabled = false;
    if (error) {
      toast(/different|same/i.test(error.message) ? "지금과 다른 비밀번호를 정해 주세요."
        : /weak|short|characters/i.test(error.message) ? "비밀번호를 더 길거나 복잡하게 정해 주세요." : "비밀번호를 바꾸지 못했어요.", "error");
      return;
    }
    $("#pw-form").reset();
    toast("비밀번호를 바꿨어요");
  };
}

/* ---------- 회원 목록 (관리자) ---------- */
/** 탭에 띄울 숫자: 승인 대기 회원, 안 읽은 피드백 */
async function adminCounts() {
  const [{ data: people }, { data: fb }] = await Promise.all([
    sb.from("profiles").select("id, approved"),
    sb.from("feedback").select("id, is_read"),
  ]);
  return { pending: (people ?? []).filter((x) => !x.approved).length, unread: (fb ?? []).filter((x) => !x.is_read).length };
}

async function renderMembers() {
  document.title = "회원 목록 — 회원 관리";
  if (!state.isAdmin) return go("#/", true);
  const [{ data: people, error }, { data: roles }] = await Promise.all([
    sb.from("profiles").select("id, nickname, email, approved, created_at").order("created_at", { ascending: false }),
    sb.from("user_roles").select("user_id, role").eq("role", "admin"),
  ]);
  if (error) { app.innerHTML = shell("/members", '<div class="paper notice"><h2>불러오지 못했어요</h2><p>잠시 뒤 새로고침해 주세요.</p></div>'); bindShell(); return; }
  const admins = new Set((roles ?? []).map((r) => r.user_id));
  const list = (people ?? []).map((p) => ({ ...p, isAdmin: admins.has(p.id), self: p.id === state.user.id }))
    .sort((a, b) => Number(a.approved) - Number(b.approved)); // 승인 대기를 위로
  const pending = list.filter((p) => !p.approved).length;
  const counts = { ...(await adminCounts()), pending };
  app.innerHTML = shell("/members", `
    <p class="muted small" style="margin:0 0 12px">회원 ${list.length}명${pending ? ` · 승인 대기 ${pending}명` : ""}</p>
    <ul class="paper people">${list.map((p) => `<li>
      <div class="person"><p class="pname">${esc(p.nickname || "이름 없음")}${p.self ? ' <span class="muted small">(나)</span>' : ""}
        ${p.isAdmin ? '<span class="badge admin">관리자</span>' : ""}${p.approved ? "" : '<span class="badge wait">승인 대기</span>'}</p>
        <p class="muted small">${esc(p.email)} · ${kstDate(p.created_at)} 가입</p></div>
      <span class="person-acts">
        ${p.self ? "" : p.approved ? `<button class="btn outline sm" type="button" data-approve="${p.id}" data-v="false">승인 취소</button>`
          : `<button class="btn primary sm" type="button" data-approve="${p.id}" data-v="true">승인</button>`}
        <button class="btn outline sm" type="button" data-edit="${p.id}">수정</button>
        ${p.self ? "" : `<button class="btn ghost sm danger" type="button" data-remove="${p.id}">계정 삭제</button>`}
      </span></li>`).join("")}</ul>`, counts);
  bindShell();
  const byId = new Map(list.map((p) => [p.id, p]));
  $$("[data-approve]").forEach((b) => b.onclick = async () => {
    const approved = b.dataset.v === "true";
    const { error: e } = await sb.rpc("approve_user", { _user_id: b.dataset.approve, _approved: approved });
    if (e) { toast("관리자만 승인할 수 있어요.", "error"); return; }
    toast(approved ? "승인했어요" : "승인을 취소했어요");
    renderMembers();
  });
  $$("[data-edit]").forEach((b) => b.onclick = () => editMember(byId.get(b.dataset.edit)));
  $$("[data-remove]").forEach((b) => b.onclick = () => removeAccount(byId.get(b.dataset.remove)));
}

/* ---------- 피드백 (관리자) ---------- */
const stamp = (iso) => {
  const t = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}.${p(t.getUTCMonth() + 1)}.${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
};
const PAGE_NAME = { "/": "메인", "/saytqtul/": "일기장", "/library/": "MEIROBOOK", "/money/": "$TDL", "/note/": "MEIRONOTE", "/pay/": "MEIROPAY" };

async function renderFeedback() {
  document.title = "피드백 — 회원 관리";
  if (!state.isAdmin) return go("#/", true);
  const { data, error } = await sb.from("feedback").select("*").order("created_at", { ascending: false });
  if (error) { app.innerHTML = shell("/feedback", '<div class="paper notice"><h2>불러오지 못했어요</h2><p>잠시 뒤 새로고침해 주세요.</p></div>'); bindShell(); return; }
  const list = data ?? [];
  const unread = list.filter((f) => !f.is_read).length;
  const counts = { ...(await adminCounts()), unread };
  app.innerHTML = shell("/feedback", `
    <div class="fb-head"><p class="muted small" style="margin:0">피드백 ${list.length}개${unread ? ` · 안 읽음 ${unread}개` : ""}</p>
      ${unread ? '<button class="btn outline sm" type="button" id="read-all">모두 읽음으로</button>' : ""}</div>
    ${list.length ? `<ul class="fb-list">${list.map((f) => `<li class="paper ${f.is_read ? "" : "unread"}">
      <div class="fb-meta"><span class="pname">${esc(f.nickname)}</span>${f.user_id ? '<span class="badge ok">회원</span>' : '<span class="badge guest">비회원</span>'}
        <span class="muted small">${stamp(f.created_at)} · ${esc(PAGE_NAME[f.page] ?? f.page)}</span></div>
      <p class="fb-text">${esc(f.content)}</p>
      <div class="person-acts"><button class="btn ghost sm" type="button" data-read="${f.id}" data-v="${!f.is_read}">${f.is_read ? "안 읽음으로" : "읽음으로"}</button>
        <button class="btn ghost sm danger" type="button" data-del="${f.id}">삭제</button></div>
    </li>`).join("")}</ul>` : '<div class="paper notice"><h2>아직 피드백이 없어요</h2><p>사이트 맨 아래 FEEDBACK 칸으로 보낸 의견이 여기에 모여요.</p></div>'}`, counts);
  bindShell();
  $$("[data-read]").forEach((b) => b.onclick = async () => {
    await sb.from("feedback").update({ is_read: b.dataset.v === "true" }).eq("id", b.dataset.read);
    renderFeedback();
  });
  $$("[data-del]").forEach((b) => b.onclick = async () => {
    if (!confirm("이 피드백을 지울까요?")) return;
    await sb.from("feedback").delete().eq("id", b.dataset.del);
    renderFeedback();
  });
  $("#read-all")?.addEventListener("click", async () => {
    await sb.from("feedback").update({ is_read: true }).eq("is_read", false);
    renderFeedback();
  });
}

/** 관리자가 직접 바꾸기: 닉네임, 이메일, 비밀번호, 승인, 관리자 권한 */
function editMember(p) {
  const dlg = document.createElement("dialog");
  dlg.innerHTML = `<form method="dialog" class="edit-form">
    <h2>${esc(p.nickname || p.email)} 회원 정보</h2>
    <label class="field">닉네임<input class="input" id="m-nick" required maxlength="40" value="${esc(p.nickname)}"></label>
    <label class="field">이메일 (로그인 아이디)<input class="input" id="m-email" type="email" required value="${esc(p.email)}"></label>
    <label class="field"><span>새 비밀번호 <span class="muted">(비워 두면 그대로)</span></span><input class="input" id="m-pw" type="text" minlength="6" autocomplete="off" placeholder="6자 이상"></label>
    ${p.self ? '<p class="muted small" style="margin:0">내 승인과 관리자 권한은 여기서 끌 수 없어요.</p>' : `<label class="check"><input type="checkbox" id="m-approved" ${p.approved ? "checked" : ""}> 승인됨 (사이트를 쓸 수 있음)</label>
    <label class="check"><input type="checkbox" id="m-admin" ${p.isAdmin ? "checked" : ""}> 관리자 (회원을 관리할 수 있음)</label>`}
    <p class="muted small" style="margin:0">이메일과 비밀번호는 확인 메일 없이 바로 바뀌어요. 바꾼 뒤 본인에게 알려 주세요.</p>
    <div class="actions"><button class="btn ghost" type="button" value="cancel">취소</button><button class="btn primary" type="submit" id="m-save">저장</button></div>
  </form>`;
  document.body.append(dlg);
  $("button[value=cancel]", dlg).onclick = () => dlg.close();
  dlg.addEventListener("close", () => dlg.remove());
  $("form", dlg).onsubmit = async (e) => {
    e.preventDefault();
    const nickname = $("#m-nick", dlg).value.trim(), email = $("#m-email", dlg).value.trim().toLowerCase(), password = $("#m-pw", dlg).value;
    if (!EMAIL.test(email)) { toast("이메일 모양이 아니에요.", "error"); return; }
    if (password && password.length < 6) { toast("비밀번호는 6자 이상이어야 해요.", "error"); return; }
    // 바뀐 칸만 보냄
    const body = { user_id: p.id };
    if (nickname !== p.nickname) body.nickname = nickname;
    if (email !== p.email) body.email = email;
    if (password) body.password = password;
    if (!p.self) {
      if ($("#m-approved", dlg).checked !== p.approved) body.approved = $("#m-approved", dlg).checked;
      if ($("#m-admin", dlg).checked !== p.isAdmin) body.is_admin = $("#m-admin", dlg).checked;
    }
    if (Object.keys(body).length === 1) { dlg.close(); return; }
    $("#m-save", dlg).disabled = true;
    const { data, error } = await sb.functions.invoke("admin-users", { body });
    if (error || data?.error) {
      let msg = data?.error;
      try { msg = msg ?? (await error.context.json()).error; } catch { /* 메시지 없음 */ }
      $("#m-save", dlg).disabled = false;
      toast(msg || "바꾸지 못했어요. 잠시 뒤 다시 해 주세요.", "error");
      return;
    }
    dlg.close();
    toast("회원 정보를 바꿨어요");
    if (p.self) await loadMe();
    renderMembers();
  };
  dlg.showModal();
}

/** 계정 삭제: 닉네임을 그대로 입력해야 지워짐. 일기·사진·서재·가계부·노트 기록도 함께 지워짐 */
function removeAccount(p) {
  const name = p.nickname || p.email;
  const dlg = document.createElement("dialog");
  dlg.innerHTML = `<form method="dialog" class="edit-form">
    <h2>계정 삭제</h2>
    <p><b>${esc(name)}</b> (${esc(p.email)}) 계정을 지워요. 이 사람의 일기, 사진, 댓글, 서재, 가계부, 노트, 근무 기록도 모두 지워지고 <b>되돌릴 수 없어요.</b></p>
    <label class="field"><span>확인을 위해 <b>${esc(name)}</b>을(를) 그대로 입력해 주세요</span><input class="input" id="confirm-name" autocomplete="off"></label>
    <div class="actions"><button class="btn ghost" type="button" value="cancel">취소</button><button class="btn danger-fill" type="submit" id="do-remove" disabled>삭제</button></div>
  </form>`;
  document.body.append(dlg);
  $("#confirm-name", dlg).oninput = (e) => { $("#do-remove", dlg).disabled = e.target.value.trim() !== name; };
  $("button[value=cancel]", dlg).onclick = () => dlg.close();
  dlg.addEventListener("close", () => dlg.remove());
  $("form", dlg).onsubmit = async (e) => {
    e.preventDefault();
    $("#do-remove", dlg).disabled = true;
    const { data: photos, error } = await sb.rpc("admin_delete_user", { _user_id: p.id });
    if (error) { $("#do-remove", dlg).disabled = false; toast("삭제하지 못했어요. 관리자만 지울 수 있어요.", "error"); return; }
    if (photos?.length) await sb.storage.from(PHOTO_BUCKET).remove(photos); // 사진 파일도 정리
    dlg.close();
    toast(`${name} 계정을 지웠어요`);
    renderMembers();
  };
  dlg.showModal();
}

/* ---------- 라우터 ---------- */
async function route() {
  $$("dialog").forEach((d) => d.remove());
  const p = path();
  if (p === "/login") return state.user ? go("#/", true) : renderLogin();
  if (!state.user) return go("#/login", true);
  if (!state.profile) await loadMe();
  if (p === "/members") return renderMembers();
  if (p === "/feedback") return renderFeedback();
  return renderMe();
}

async function start() {
  fromSite();
  if ((!SUPABASE_URL || !SUPABASE_ANON_KEY) && !window.__ACCOUNT_TEST_CLIENT__) {
    app.innerHTML = '<main class="auth"><div class="paper notice"><h2>연결 준비 중</h2><p>js/config.js에 Supabase 주소와 키를 넣어 주세요.</p></div></main>';
    return;
  }
  sb = window.__ACCOUNT_TEST_CLIENT__ ?? (await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm"))
    .createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true } });
  const { data } = await sb.auth.getSession();
  state.user = data.session?.user ?? null;
  // 이메일 변경 확인 메일의 링크로 돌아온 경우
  if (new URLSearchParams(location.search).has("code")) {
    history.replaceState(null, "", location.pathname + (state.user ? "#/" : "#/login"));
    setTimeout(() => toast(state.user ? "이메일 확인을 마쳤어요" : "링크가 만료됐거나 다른 브라우저에서 열렸어요.", state.user ? "" : "error"), 300);
  }
  sb.auth.onAuthStateChange((event, session) => {
    const before = state.user?.id;
    state.user = session?.user ?? null;
    if (state.user?.id === before) return;
    state.profile = null; state.isAdmin = false;
    if (event === "SIGNED_IN" && path() === "/login") go("#/", true);
    else if (!state.user) go("#/login", true);
  });
  window.addEventListener("hashchange", route);
  route();
}

start();
