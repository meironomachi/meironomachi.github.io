import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js?v=202610241614";
import {
  MIN_WAGE_2026, RATES, TAX_TYPES, taxName, won, hoursText, hoursShort, isDay, isMonth, shiftMonth, monthCells, dow,
  shiftPay, monthSummary, compare, dayTotals,
} from "./pay.js?v=202610241614";

const app = document.getElementById("app");
let sb = null;
const state = { user: null, profile: null, places: [], shifts: [] };
const COLORS = ["#0031b0", "#2f9e44", "#e8590c", "#9c36b5", "#c2255c", "#1098ad", "#5f3dc4", "#868e96"];

/* ---------- 도우미 ---------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const monthName = (m) => `${Number(m.slice(0, 4))}년 ${Number(m.slice(5))}월`;
const dayName = (d) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8))}일 ${DOW[dow(d)]}요일`;
const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : "#0031b0");
const num = (v) => Number(String(v).replace(/[^\d]/g, "")) || 0;
const placeOf = (id) => state.places.find((p) => p.id === id);

function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), 2800);
}

const ICON = {
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  store: '<path d="M3 9 5 4h14l2 5M3 9h18v11H3zM9 20v-6h6v6"/>',
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
  return { path, params: new URLSearchParams(query) };
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
const TABS = [{ path: "/", label: "달력", icon: "calendar" }, { path: "/places", label: "일하는 곳", icon: "store" }];
const brand = () => "MEIRO<span>PAY</span>";
function shell(current, inner) {
  const name = state.profile?.nickname || state.user.email;
  return `<main class="wrap">
    <header class="top">
      <h1 class="pay-mark"><a href="#/">${brand()}</a></h1>
      <div class="who">
        <a class="btn ghost sm meiro-btn" href="/" title="meiro.kr 처음으로">MEIRO</a>
        <span>${esc(name)}</span>
        <a class="btn ghost sm" href="/account/?from=pay">회원 관리</a>
        ${themeButton()}
        <button class="btn ghost sm" type="button" data-act="logout">로그아웃</button>
      </div>
    </header>
    <nav class="tabs" aria-label="MEIROPAY 메뉴">${TABS.map((t) => `<a href="#${t.path}" ${t.path === current ? 'aria-current="page"' : ""}>${icon(t.icon)}${t.label}</a>`).join("")}</nav>
    ${inner}
  </main>`;
}
function bindShell() {
  $('[data-act="logout"]')?.addEventListener("click", async () => { await sb.auth.signOut(); go("#/login", true); });
}
const waiting = () => `<div class="paper notice"><h2>승인을 기다리고 있어요</h2><p>관리자가 가입을 승인하면 쓸 수 있어요.</p></div>`;

/* ---------- 데이터 ---------- */
async function loadAll() {
  const [p, s] = await Promise.all([
    sb.from("pay_places").select("*").order("sort").order("created_at"),
    sb.from("pay_shifts").select("*").order("work_date").order("start_time"),
  ]);
  if (p.error || s.error) throw p.error ?? s.error;
  state.places = (p.data ?? []).map((x) => ({ ...x, color: safeColor(x.color) }));
  state.shifts = s.data ?? [];
}

/* ---------- 로그인 (일기장과 같은 계정) ---------- */
function renderLogin() {
  document.title = "로그인 — MEIROPAY";
  let mode = "in";
  const draw = () => {
    app.innerHTML = `<a class="home-link" href="/" title="meiro.kr 처음으로">← MEIRO</a>${themeButton("corner")}<main class="auth"><div class="paper">
      <h1 class="pay-mark" style="text-align:center"><a href="#/">${brand()}</a></h1>
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

/* ---------- 달력 + 이번 달 월급 ---------- */
function renderCalendar(params) {
  const month = isMonth(params.get("month")) ? params.get("month") : kstToday().slice(0, 7);
  document.title = `${monthName(month)} — MEIROPAY`;
  if (!state.places.length) {
    app.innerHTML = shell("/", `<div class="paper notice"><h2>먼저 일하는 곳을 만들어 주세요</h2>
      <p>시급과 세금 방식(3.3% · 4대보험 · 세금 없음)을 정해 두면, 달력에서 날짜를 눌러 근무를 적을 수 있어요.</p>
      <p style="margin-top:20px"><a class="btn primary" href="#/places?new=1">일하는 곳 만들기</a></p></div>`);
    bindShell();
    return;
  }
  const totals = dayTotals(state.shifts, state.places);
  const today = kstToday();
  app.innerHTML = shell("/", `<div class="pay-layout">
    <section class="paper big-cal" aria-label="${monthName(month)} 달력">
      <div class="cal-head">
        <a class="btn ghost sm" href="#/?month=${shiftMonth(month, -1)}" aria-label="이전 달">${icon("left")}</a>
        <h2>${monthName(month)}</h2>
        <a class="btn ghost sm" href="#/?month=${shiftMonth(month, 1)}" aria-label="다음 달">${icon("right")}</a>
        ${month !== today.slice(0, 7) ? `<a class="btn outline sm today-btn" href="#/">이번 달</a>` : ""}
      </div>
      <div class="cal-grid">${DOW.map((d, i) => `<span class="dow ${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${d}</span>`).join("")}
        ${monthCells(month).map((d) => {
          if (!d) return '<span class="blank"></span>';
          const t = totals[d];
          return `<button type="button" class="day ${d === today ? "today" : ""} ${t ? "has" : ""} ${dow(d) === 0 ? "sun" : dow(d) === 6 ? "sat" : ""}" data-day="${d}" aria-label="${dayName(d)}${t ? `, ${hoursText(t.minutes)}, ${won(t.pay)}` : ""}">
            <span class="dnum">${Number(d.slice(8))}</span>
            ${t ? `<span class="chips">${t.items.map((x) => `<span class="chip" style="--c:${x.place.color}"><i></i>${esc(x.place.name)} ${hoursShort(x.work)}</span>`).join("")}</span>
              <span class="dpay">${t.pay.toLocaleString("ko-KR")}</span>` : ""}
          </button>`;
        }).join("")}
      </div>
      <p class="cal-note">날짜를 누르면 근무를 적거나 고칠 수 있어요. 칸의 금액은 그날의 세전 금액(주휴수당 빼고)이에요.</p>
    </section>
    <aside class="summary" id="summary"></aside>
  </div>`);
  bindShell();
  $$("[data-day]").forEach((b) => b.onclick = () => dayDialog(b.dataset.day));
  drawSummary(month);
}

const delta = (v, unit = "%") => {
  if (v === null || v === undefined) return '<span class="delta">—</span>';
  const cls = v > 0 ? "up" : v < 0 ? "down" : "";
  return `<span class="delta ${cls}">${v > 0 ? "▲" : v < 0 ? "▼" : ""} ${Math.abs(v)}${unit}</span>`;
};

function drawSummary(month) {
  const cur = monthSummary(state.shifts, state.places, month);
  const prev = monthSummary(state.shifts, state.places, shiftMonth(month, -1));
  const cmp = compare(cur, prev);
  const max = Math.max(cur.gross, prev.gross, 1);
  const bar = (label, g, n) => `<div class="cmp-row"><span class="cmp-label">${label}</span>
    <div class="cmp-bars"><span class="b gross" style="width:${g / max * 100}%"></span><span class="b net" style="width:${n / max * 100}%"></span></div>
    <span class="cmp-num">${won(n)}<small>세전 ${won(g)}</small></span></div>`;
  $("#summary").innerHTML = `
    <section class="paper sum-card">
      <p class="muted small" style="margin:0">${monthName(month)} 받을 돈 (세후)</p>
      <p class="net-big">${won(cur.net)}</p>
      <dl class="sum-lines">
        <div><dt>세전</dt><dd>${won(cur.gross)}</dd></div>
        <div><dt>떼는 돈</dt><dd>− ${won(cur.deducted)} <small>(${cur.gross ? cur.rate.toFixed(1) : "0.0"}%)</small></dd></div>
        <div><dt>일한 시간</dt><dd>${hoursText(cur.minutes)}</dd></div>
      </dl>
      <div class="cmp">
        <p class="cmp-title">전월(${Number(shiftMonth(month, -1).slice(5))}월) 대비</p>
        <ul class="deltas">
          <li><span>세전</span>${delta(cmp.gross)}</li>
          <li><span>세후</span>${delta(cmp.net)}</li>
          <li><span>공제율</span>${delta(cmp.rate, "%p")}</li>
          <li><span>근무 시간</span>${delta(cmp.hours)}</li>
        </ul>
        ${bar(`${Number(month.slice(5))}월`, cur.gross, cur.net)}
        ${bar(`${Number(shiftMonth(month, -1).slice(5))}월`, prev.gross, prev.net)}
        <p class="legend"><span class="sw gross"></span>세전 <span class="sw net"></span>세후</p>
      </div>
    </section>
    ${cur.byPlace.map((x) => `<section class="paper place-card" style="--c:${x.place.color}">
      <div class="pc-head"><h3><i></i>${esc(x.place.name)}</h3><span class="tax-badge">${taxName(x.place.tax_type)}</span></div>
      <p class="muted small" style="margin:2px 0 10px">${x.days}일 · ${hoursText(x.minutes)}${x.night ? ` · 야간 ${hoursText(x.night)}` : ""}</p>
      <dl class="lines">
        <div><dt>기본급</dt><dd>${won(x.base)}</dd></div>
        ${x.weekly ? `<div><dt>주휴수당 <small>(${x.weeks.length}주)</small></dt><dd>${won(x.weekly)}</dd></div>` : ""}
        ${x.overtime ? `<div><dt>연장수당 (0.5배)</dt><dd>${won(x.overtime)}</dd></div>` : ""}
        ${x.nightPay ? `<div><dt>야간수당 (0.5배)</dt><dd>${won(x.nightPay)}</dd></div>` : ""}
        <div class="strong"><dt>세전</dt><dd>${won(x.gross)}</dd></div>
        ${x.deductions.map((d) => `<div class="minus"><dt>${esc(d.name)}</dt><dd>− ${won(d.amount)}</dd></div>`).join("")}
        <div class="strong net"><dt>세후</dt><dd>${won(x.net)}</dd></div>
      </dl>
    </section>`).join("")}
    ${cur.byPlace.some((x) => x.place.tax_type === "insured") ? `<p class="fine">4대보험은 ${RATES.year}년 근로자 부담 요율로, 근로소득세는 간이세액표 공식(본인 1명)으로 계산한 근사치예요. 실제 급여명세서와 몇백 원~몇천 원 다를 수 있어요.</p>` : ""}
    <p class="fine">주휴수당은 월~일 한 주에 15시간 이상 일했을 때, 그 주의 일요일이 있는 달에 넣어요.</p>`;
}

/* ---------- 날짜 창: 근무 적기·고치기 ---------- */
function dayDialog(day, editId = null) {
  $$("dialog").forEach((d) => d.remove());
  const dlg = document.createElement("dialog");
  dlg.className = "day-dlg";
  document.body.append(dlg);
  const list = () => state.shifts.filter((s) => s.work_date === day);
  const lastOf = (placeId) => [...state.shifts].reverse().find((s) => s.place_id === placeId);

  const draw = (editing = null) => {
    const shifts = list();
    const e = editing ? shifts.find((s) => s.id === editing) : null;
    const place0 = (e ? placeOf(e.place_id) : placeOf(state.shifts.at(-1)?.place_id)) ?? state.places[0]; // 마지막으로 적은 곳
    dlg.innerHTML = `<h2>${dayName(day)}</h2>
      <button class="btn ghost sm dialog-close" type="button" aria-label="닫기">닫기</button>
      ${shifts.length ? `<ul class="shift-list">${shifts.map((s) => {
        const p = placeOf(s.place_id), r = shiftPay(s, p);
        return `<li style="--c:${p.color}" class="${s.id === editing ? "editing" : ""}">
          <div><p class="sl-top"><i></i><b>${esc(p.name)}</b> ${s.start_time}~${s.end_time}${s.break_min ? ` · 휴게 ${s.break_min}분` : ""}</p>
            <p class="muted small">${hoursText(r.work)} × ${won(r.wage)}${r.overtime ? ` · 연장 +${won(r.overtime)}` : ""}${r.nightPay ? ` · 야간 +${won(r.nightPay)}` : ""}${s.memo ? ` · ${esc(s.memo)}` : ""}</p></div>
          <span class="sl-pay">${won(r.total)}</span>
          <span class="sl-acts"><button class="btn ghost sm" type="button" data-edit="${s.id}">고치기</button><button class="btn ghost sm danger" type="button" data-del="${s.id}">삭제</button></span>
        </li>`;
      }).join("")}</ul>` : '<p class="muted small" style="margin:0 0 4px">아직 적은 근무가 없어요.</p>'}
      <form class="shift-form" id="shift-form">
        <p class="form-title">${e ? "근무 고치기" : "근무 추가"}</p>
        <div class="place-pick" role="radiogroup" aria-label="일하는 곳">${state.places.map((p) => `<label style="--c:${p.color}"><input type="radio" name="place" value="${p.id}" ${p.id === place0.id ? "checked" : ""}><span><i></i>${esc(p.name)}</span></label>`).join("")}</div>
        <div class="time-row">
          <label class="field">시작<input class="input" type="time" name="start" required value="${e?.start_time ?? lastOf(place0.id)?.start_time ?? "09:00"}"></label>
          <label class="field">끝<input class="input" type="time" name="end" required value="${e?.end_time ?? lastOf(place0.id)?.end_time ?? "18:00"}"></label>
          <label class="field">휴게(분)<input class="input" type="number" name="brk" min="0" max="600" step="5" inputmode="numeric" value="${e?.break_min ?? lastOf(place0.id)?.break_min ?? 0}"></label>
        </div>
        <div class="time-row two">
          <label class="field">시급<input class="input" name="wage" inputmode="numeric" value="${(e?.wage ?? place0.wage).toLocaleString("ko-KR")}"></label>
          <label class="field">메모<input class="input" name="memo" maxlength="80" value="${esc(e?.memo ?? "")}" placeholder="선택"></label>
        </div>
        <p class="preview" id="preview"></p>
        <div class="actions">${e ? '<button class="btn ghost" type="button" id="cancel-edit">새로 적기</button>' : ""}<button class="btn primary" type="submit">${e ? "고친 내용 저장" : "추가"}</button></div>
      </form>`;
    const f = $("#shift-form", dlg);
    const read = () => {
      const p = placeOf(f.place.value);
      const wage = num(f.wage.value);
      return { p, s: { start_time: f.start.value, end_time: f.end.value, break_min: Math.max(0, Number(f.brk.value) || 0), wage: wage && wage !== p.wage ? wage : null, memo: f.memo.value.trim() } };
    };
    const preview = () => {
      const { p, s } = read();
      if (!f.start.value || !f.end.value) { $("#preview", dlg).textContent = ""; return; }
      const r = shiftPay(s, p);
      $("#preview", dlg).innerHTML = `${hoursText(r.work)}${r.night ? ` (야간 ${hoursText(r.night)})` : ""} → <b>${won(r.total)}</b>${r.overtime || r.nightPay ? ` <span class="muted">(기본 ${won(r.base)}${r.overtime ? ` + 연장 ${won(r.overtime)}` : ""}${r.nightPay ? ` + 야간 ${won(r.nightPay)}` : ""})</span>` : ""}${toMinEnd(s) ? ' <span class="muted">· 다음 날까지</span>' : ""}`;
    };
    // 일하는 곳을 바꾸면 그곳의 시급과 지난번 근무 시각으로 채움
    $$('input[name="place"]', f).forEach((r) => r.onchange = () => {
      const p = placeOf(r.value), last = lastOf(p.id);
      f.wage.value = p.wage.toLocaleString("ko-KR");
      if (!e && last) { f.start.value = last.start_time; f.end.value = last.end_time; f.brk.value = last.break_min; }
      preview();
    });
    f.addEventListener("input", preview);
    f.wage.addEventListener("blur", () => { const n = num(f.wage.value); f.wage.value = n ? n.toLocaleString("ko-KR") : ""; });
    preview();
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      const { p, s } = read();
      if (!s.start_time || !s.end_time) return;
      if (s.start_time === s.end_time) { toast("시작과 끝 시각이 같아요.", "error"); return; }
      if (shiftPay(s, p).work <= 0) { toast("휴게시간이 일한 시간보다 길어요.", "error"); return; }
      const row = { ...s, place_id: p.id, work_date: day };
      const res = e ? await sb.from("pay_shifts").update(row).eq("id", e.id) : await sb.from("pay_shifts").insert(row);
      if (res.error) { toast("저장하지 못했어요.", "error"); return; }
      await loadAll();
      toast(e ? "고쳤어요" : "추가했어요");
      draw();
      refresh();
    };
    $("#cancel-edit", dlg)?.addEventListener("click", () => draw());
    $$("[data-edit]", dlg).forEach((b) => b.onclick = () => draw(b.dataset.edit));
    $$("[data-del]", dlg).forEach((b) => b.onclick = async () => {
      if (!confirm("이 근무를 지울까요?")) return;
      await sb.from("pay_shifts").delete().eq("id", b.dataset.del);
      await loadAll();
      draw();
      refresh();
    });
    $(".dialog-close", dlg).onclick = () => dlg.close();
  };
  const refresh = () => { const scroll = scrollY; renderCalendar(parseHash().params); scrollTo(0, scroll); };
  dlg.addEventListener("close", () => dlg.remove());
  draw(editId);
  dlg.showModal();
}
const toMinEnd = (s) => s.end_time <= s.start_time;

/* ---------- 일하는 곳 ---------- */
function renderPlaces(params) {
  document.title = "일하는 곳 — MEIROPAY";
  const count = (id) => state.shifts.filter((s) => s.place_id === id).length;
  app.innerHTML = shell("/places", `
    <div class="page-head"><h2 class="page-title" style="margin:0">일하는 곳</h2><button class="btn primary" type="button" id="add-place">+ 일하는 곳 추가</button></div>
    ${state.places.length ? `<ul class="places">${state.places.map((p) => `<li class="paper" style="--c:${p.color}">
      <div class="pl-main"><h3><i></i>${esc(p.name)}</h3>
        <p class="muted small">시급 ${won(p.wage)} · ${esc(TAX_TYPES.find((t) => t.id === p.tax_type)?.long ?? "")}</p>
        <p class="muted small">${p.weekly ? "주휴수당 계산" : "주휴수당 없음"} · ${p.extra ? "5인 이상(연장·야간 1.5배)" : "가산수당 없음"} · 근무 ${count(p.id)}번</p></div>
      <span class="pl-acts"><button class="btn outline sm" type="button" data-edit="${p.id}">고치기</button></span>
    </li>`).join("")}</ul>` : '<p class="empty">아직 일하는 곳이 없어요.</p>'}`);
  bindShell();
  $("#add-place").onclick = () => placeDialog(null);
  $$("[data-edit]").forEach((b) => b.onclick = () => placeDialog(placeOf(b.dataset.edit)));
  if (params.get("new") && !state.places.length) placeDialog(null);
}

function placeDialog(p) {
  const dlg = document.createElement("dialog");
  const color = p?.color ?? COLORS[state.places.length % COLORS.length];
  dlg.innerHTML = `<form method="dialog" class="place-form">
    <h2>${p ? "일하는 곳 고치기" : "일하는 곳 추가"}</h2>
    <label class="field">이름<input class="input" name="name" required maxlength="30" value="${esc(p?.name ?? "")}" placeholder="예: 동네 카페"></label>
    <div class="time-row two">
      <label class="field">시급<input class="input" name="wage" required inputmode="numeric" value="${(p?.wage ?? MIN_WAGE_2026).toLocaleString("ko-KR")}"></label>
      <label class="field">색<input type="color" name="color" value="${color}"></label>
    </div>
    <p class="muted small" style="margin:-6px 0 0">2026년 최저시급은 ${won(MIN_WAGE_2026)}이에요.</p>
    <fieldset class="tax-pick"><legend>세금 방식 <span class="muted">(급여명세서·계약서에 적힌 대로)</span></legend>
      ${TAX_TYPES.map((t) => `<label><input type="radio" name="tax" value="${t.id}" ${(p?.tax_type ?? "biz33") === t.id ? "checked" : ""}><span><b>${t.name}</b><small>${t.long}</small></span></label>`).join("")}
    </fieldset>
    <label class="check"><input type="checkbox" name="weekly" ${p?.weekly ?? true ? "checked" : ""}><span><b>주휴수당</b> 계산 <small>한 주에 15시간 이상 일하면 하루치를 더 받아요</small></span></label>
    <label class="check"><input type="checkbox" name="extra" ${p?.extra ? "checked" : ""}><span><b>상시 5명 이상</b> 일하는 곳 <small>연장(하루 8시간 넘게)·야간(22~06시)에 0.5배를 더 받아요</small></span></label>
    <div class="actions">${p ? '<button class="btn ghost danger" type="button" id="del-place">삭제</button><span class="spacer"></span>' : ""}<button class="btn ghost" type="button" value="cancel">취소</button><button class="btn primary" type="submit">저장</button></div>
  </form>`;
  document.body.append(dlg);
  const f = $("form", dlg);
  f.wage.addEventListener("blur", () => { const n = num(f.wage.value); f.wage.value = n ? n.toLocaleString("ko-KR") : ""; });
  $("button[value=cancel]", dlg).onclick = () => dlg.close();
  dlg.addEventListener("close", () => dlg.remove());
  $("#del-place", dlg)?.addEventListener("click", async () => {
    const n = state.shifts.filter((s) => s.place_id === p.id).length;
    if (!confirm(`'${p.name}'을(를) 지울까요?${n ? ` 여기서 일한 근무 ${n}번도 함께 지워져요.` : ""}`)) return;
    await sb.from("pay_places").delete().eq("id", p.id);
    await loadAll();
    dlg.close();
    toast("지웠어요");
    route();
  });
  f.onsubmit = async (e) => {
    e.preventDefault();
    const wage = num(f.wage.value);
    if (!f.name.value.trim() || !wage) { toast("이름과 시급을 적어 주세요.", "error"); return; }
    const row = { name: f.name.value.trim(), wage, color: f.color.value, tax_type: f.tax.value, weekly: f.weekly.checked, extra: f.extra.checked };
    const res = p ? await sb.from("pay_places").update(row).eq("id", p.id) : await sb.from("pay_places").insert({ ...row, sort: state.places.length });
    if (res.error) { toast("저장하지 못했어요.", "error"); return; }
    await loadAll();
    dlg.close();
    toast("저장했어요");
    if (!p && state.places.length === 1) go("#/", true); else route();
  };
  dlg.showModal();
}

/* ---------- 라우터 ---------- */
async function route() {
  $$("dialog").forEach((d) => d.remove());
  const { path, params } = parseHash();
  if (path === "/login") return state.user ? go("#/", true) : renderLogin();
  if (!state.user) return go("#/login", true);
  if (!state.profile) {
    const { data } = await sb.from("profiles").select("nickname, approved").eq("id", state.user.id).maybeSingle();
    state.profile = data ?? { nickname: "", approved: false };
  }
  if (!state.profile.approved) { app.innerHTML = shell("/", waiting()); bindShell(); return; }
  try {
    await loadAll();
    if (path === "/places") return renderPlaces(params);
    if (isDay(params.get("day"))) { renderCalendar(new URLSearchParams({ month: params.get("day").slice(0, 7) })); return dayDialog(params.get("day")); }
    return renderCalendar(params);
  } catch {
    app.innerHTML = shell("/", '<div class="paper notice"><h2>불러오지 못했어요</h2><p>잠시 뒤 새로고침해 주세요. 계속되면 데이터베이스 설정(pay.sql)을 확인해 주세요.</p></div>');
    bindShell();
  }
}

async function start() {
  if ((!SUPABASE_URL || !SUPABASE_ANON_KEY) && !window.__PAY_TEST_CLIENT__) {
    app.innerHTML = '<main class="auth"><div class="paper notice"><h2>연결 준비 중</h2><p>js/config.js에 Supabase 주소와 키를 넣어 주세요.</p></div></main>';
    return;
  }
  sb = window.__PAY_TEST_CLIENT__ ?? (await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm"))
    .createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true } });
  window.__meiroSb = sb; // 페이지 아래 FEEDBACK 칸도 같은 로그인을 씀
  dispatchEvent(new Event("meiro-sb"));
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
