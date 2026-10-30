import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js?v=202610300831";
import {
  KINDS, kindName, DEFAULT_CATEGORIES, BANKS, kstDay, kstMonth, monthRange, shiftMonth, parseAmount, won, signedWon,
  parseBankRows, importKey, classify, normalizePlace, findCancelPairs, findTransferPairs, findManualMatch, fromScreenshotRows, parseKstDateTime,
  monthSummary, budgetStatus, changeRate, accountBalance, frequentEntries,
  recurringDay, recurringActive, recurringDueMonths, recurringTx, recurringTotals, goalStatus, inflowByCat,
} from "./money.js?v=202610300831";

const app = document.getElementById("app");
let sb = null;
const state = { user: null, profile: null };
// 계좌·분류·규칙·예산 (화면마다 새로 읽음)
const base = { accounts: [], categories: [], rules: [], budgets: [], recurring: [] };

/* ---------- 도우미 ---------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const thisMonth = () => kstMonth(new Date().toISOString());
const monthLabel = (m) => `${Number(m.slice(0, 4))}년 ${Number(m.slice(5))}월`;
const dayLabel = (d) => { const t = new Date(`${d}T00:00:00Z`); return `${t.getUTCMonth() + 1}월 ${t.getUTCDate()}일 (${DOW[t.getUTCDay()]})`; };
const kstTime = (iso) => { const d = new Date(Date.parse(iso) + 9 * 3600 * 1000); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };
const toLocalInput = (iso) => { const d = new Date(Date.parse(iso) + 9 * 3600 * 1000); return d.toISOString().slice(0, 16); };
const fromLocalInput = (v) => new Date(Date.parse(`${v}:00Z`) - 9 * 3600 * 1000).toISOString();
const catOf = (id) => base.categories.find((c) => c.id === id);
const accOf = (id) => base.accounts.find((a) => a.id === id);
const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : "#868e96");
const remember = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } return null; };

function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), 2800);
}

const ICON = {
  month: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  bank: '<path d="m3 10 9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18"/>',
  budget: '<circle cx="12" cy="12" r="9"/><path d="M12 3v9l6 6"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
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
const rerender = () => route();

/* ---------- 테마 ---------- */
const themeButton = (extra = "") => `<button class="btn ghost sm theme-btn ${extra}" type="button" data-act="theme" aria-label="라이트/다크 모드 바꾸기" title="라이트/다크 모드 바꾸기"><span class="moon">${icon("moon")}</span><span class="sun">${icon("sun")}</span></button>`;
document.addEventListener("click", (e) => {
  if (!e.target.closest('[data-act="theme"]')) return;
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  remember("meiro-theme", root.dataset.theme);
});

/* ---------- 공통 틀 ---------- */
const TABS = [
  { path: "/", label: "이번 달", icon: "month" },
  { path: "/list", label: "내역", icon: "list" },
  { path: "/accounts", label: "계좌", icon: "bank" },
  { path: "/budget", label: "예산·분류", icon: "budget" },
  { path: "/import", label: "가져오기", icon: "upload" },
];
function shell(current, inner) {
  const name = state.profile?.nickname || state.user.email;
  return `<main class="wrap">
    <header class="top">
      <h1 class="money-mark"><a href="#/"><span>$</span>TDL</a></h1>
      <div class="who">
        <a class="btn ghost sm meiro-btn" href="/" title="meiro.kr 처음으로">MEIRO</a>
        <span>${esc(name)}</span>
        <a class="btn ghost sm" href="/account/?from=money">회원 관리</a>
        ${themeButton()}
        <button class="btn ghost sm" type="button" data-act="logout">로그아웃</button>
      </div>
    </header>
    <nav class="tabs" aria-label="가계부 메뉴">${TABS.map((t) => `<a href="#${t.path}" ${t.path === current ? 'aria-current="page"' : ""}>${icon(t.icon)}${t.label}</a>`).join("")}</nav>
    ${inner}
  </main>
  <button class="fab" type="button" id="fab" aria-label="빠른 입력">${icon("plus")}</button>`;
}
function bindShell() {
  $('[data-act="logout"]')?.addEventListener("click", async () => { await sb.auth.signOut(); go("#/login", true); });
  $("#fab")?.addEventListener("click", () => txDialog(null));
}
const loading = () => '<p class="muted">불러오는 중…</p>';
const fill = (html) => { const main = $("main"); main.lastElementChild.remove(); main.insertAdjacentHTML("beforeend", html); };
const monthNav = (path, m) => `<div class="month-nav">
    <a class="btn ghost sm" href="#${path}?m=${shiftMonth(m, -1)}" aria-label="이전 달">${icon("left")}</a>
    <h2>${monthLabel(m)}</h2>
    <a class="btn ghost sm" href="#${path}?m=${shiftMonth(m, 1)}" aria-label="다음 달">${icon("right")}</a>
    ${m !== thisMonth() ? `<a class="btn outline sm" href="#${path}">이번 달</a>` : ""}
  </div>`;

/* ---------- 데이터 ---------- */
async function loadBase() {
  const [a, c, r, b] = await Promise.all([
    sb.from("money_accounts").select("*").order("sort"),
    sb.from("money_categories").select("*").order("sort"),
    sb.from("money_rules").select("*"),
    sb.from("money_budgets").select("*"),
  ]);
  if (a.error) throw a.error;
  base.accounts = a.data ?? []; base.categories = (c.data ?? []).map((x) => ({ ...x, color: safeColor(x.color) }));
  base.rules = r.data ?? []; base.budgets = b.data ?? [];
  // 처음 쓰는 날: 기본 분류와 카카오뱅크·현금 계좌를 만들어 둠
  if (!base.categories.length) {
    await sb.from("money_categories").insert(DEFAULT_CATEGORIES);
    base.categories = ((await sb.from("money_categories").select("*").order("sort")).data ?? []);
  }
  if (!base.accounts.length) {
    await sb.from("money_accounts").insert([{ name: "카카오뱅크", bank: "kakao", sort: 0 }, { name: "현금", bank: "cash", sort: 1 }]);
    base.accounts = ((await sb.from("money_accounts").select("*").order("sort")).data ?? []);
  }
  // 고정 수입·지출 (표가 아직 없으면 건너뜀)
  const rec = await sb.from("money_recurring").select("*").order("created_at");
  base.recurring = rec.error ? [] : rec.data ?? [];
  await materializeRecurring();
}

/** 날짜가 지난 고정 항목을 내역으로 만듦. 같은 달에 두 번 만들지 않음 (이미 있으면 건너뜀) */
async function materializeRecurring() {
  if (!base.recurring.length) return;
  const today = kstDay(new Date().toISOString());
  const { data } = await sb.from("money_transactions").select("recurring_id, recurring_month").not("recurring_id", "is", null);
  const made = new Set((data ?? []).map((t) => `${t.recurring_id}|${t.recurring_month}`));
  const rows = base.recurring.flatMap((r) => recurringDueMonths(r, today).filter((m) => !made.has(`${r.id}|${m}`)).map((m) => recurringTx(r, m)));
  if (rows.length) await sb.from("money_transactions").insert(rows);
}
async function loadMonth(m) {
  const [from, to] = monthRange(m);
  const { data, error } = await sb.from("money_transactions").select("*").gte("occurred_at", from).lt("occurred_at", to).order("occurred_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/* ---------- 로그인 ---------- */
function renderLogin() {
  document.title = "로그인 — $TDL";
  app.innerHTML = `<a class="home-link" href="/" title="meiro.kr 처음으로">← MEIRO</a>${themeButton("corner")}<main class="auth"><div class="paper">
    <h1 class="money-mark" style="text-align:center"><a href="#/"><span>$</span>TDL</a></h1>
    <p class="muted small" style="text-align:center;margin:8px 0 0">일기장과 같은 계정으로 들어가요</p>
    <form id="auth-form">
      <label class="field">이메일<input class="input" id="email" type="email" required autocomplete="email"></label>
      <label class="field">비밀번호<input class="input" id="pw" type="password" minlength="6" required autocomplete="current-password"></label>
      <button class="btn primary" type="submit">로그인</button>
    </form>
    <p class="muted small" style="text-align:center;margin-top:16px">계정이 없으면 <a href="/saytqtul/#/auth">일기장에서 가입</a>해 주세요.</p>
    <p class="find-links"><a href="/saytqtul/#/find-id">아이디(이메일) 찾기</a><span aria-hidden="true">·</span><a href="/saytqtul/#/forgot">비밀번호 찾기</a></p>
  </div></main>`;
  $("#auth-form").onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.signInWithPassword({ email: $("#email").value.trim(), password: $("#pw").value });
    if (error) toast("로그인에 실패했어요. 이메일과 비밀번호를 확인해 주세요.", "error");
  };
}

/* ---------- 이번 달 ---------- */
async function renderMonth(params) {
  const m = params.get("m") || thisMonth();
  document.title = `${monthLabel(m)} — $TDL`;
  app.innerHTML = shell("/", loading());
  bindShell();
  const [txs, prev] = await Promise.all([loadMonth(m), loadMonth(shiftMonth(m, -1))]);
  shown = txs;
  const s = monthSummary(txs), p = monthSummary(prev);
  const total = base.budgets.find((b) => !b.category_id);
  const tb = budgetStatus(s.expense, total?.amount);
  const cats = base.categories.filter((c) => c.kind === "expense");
  const rows = [...cats.map((c) => ({ c, spent: s.byCat[c.id] ?? 0, before: p.byCat[c.id] ?? 0, budget: base.budgets.find((b) => b.category_id === c.id)?.amount }))]
    .filter((r) => r.spent || r.budget).sort((a, b) => b.spent - a.spent);
  const none = s.byCat.none ?? 0;
  // 수입·저축 목표와 이 달의 고정 항목
  const inflow = inflowByCat(txs), prevInflow = inflowByCat(prev);
  const incomeNone = txs.filter((t) => t.kind === "income" && !t.category_id).reduce((sum, t) => sum + t.amount, 0);
  const incomeRows = base.categories.filter((c) => c.kind === "income")
    .map((c) => ({ c, amt: inflow[c.id] ?? 0, before: prevInflow[c.id] ?? 0, budget: base.budgets.find((b) => b.category_id === c.id)?.amount }))
    .filter((r) => r.amt || r.budget).sort((a, b) => b.amt - a.amt);
  const goals = base.categories.filter((c) => c.kind === "income" || c.kind === "saving")
    .map((c) => ({ c, got: inflow[c.id] ?? 0, goal: base.budgets.find((b) => b.category_id === c.id)?.amount })).filter((g) => g.goal);
  const fixed = base.recurring.filter((r) => recurringActive(r, m)).map((r) => ({ r, tx: txs.find((t) => t.recurring_id === r.id) }))
    .sort((a, b) => recurringDay(a.r, m).localeCompare(recurringDay(b.r, m)));
  const ft = recurringTotals(base.recurring, m);
  const daysLeft = m === thisMonth() ? (() => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate() - Number(kstDay(new Date().toISOString()).slice(8)) + 1; })() : 0;

  fill(`${monthNav("/", m)}
    <section class="stats3">
      <div><span>수입</span><b class="in">${won(s.income)}</b></div>
      <div><span>지출</span><b>${won(s.expense)}</b>${changeRate(s.expense, p.expense) !== null ? `<small class="${s.expense > p.expense ? "up" : "down"}">지난달보다 ${Math.abs(changeRate(s.expense, p.expense))}% ${s.expense > p.expense ? "더" : "덜"} 씀</small>` : ""}</div>
      <div><span>남은 돈</span><b class="${s.net < 0 ? "neg" : ""}">${signedWon(s.net)}</b>${s.saving ? `<small>저축 ${won(s.saving)}</small>` : ""}</div>
    </section>

    <section class="paper budget-card">
      <div class="section-head"><h3>예산</h3><a class="btn ghost sm" href="#/budget">예산 정하기</a></div>
      ${total ? `<div class="budget-total">
          <div class="bt-line"><b>${won(s.expense)}</b><span class="muted"> / ${won(total.amount)}</span><span class="bt-left ${tb.state}">${tb.state === "over" ? `${won(s.expense - total.amount)} 넘음` : `${won(total.amount - s.expense)} 남음`}</span></div>
          <div class="meter ${tb.state}"><span style="width:${Math.min(100, tb.ratio * 100)}%"></span></div>
          ${daysLeft > 0 && tb.state !== "over" ? `<p class="muted small">남은 ${daysLeft}일 동안 하루 ${won(Math.floor((total.amount - s.expense) / daysLeft))}씩 쓸 수 있어요</p>` : ""}
        </div>` : '<p class="empty-hint">한 달 예산을 정하면 얼마나 남았는지 보여 드려요.</p>'}
    </section>

    ${goals.length ? `<section class="paper budget-card"><div class="section-head"><h3>수입·저축 목표</h3><a class="btn ghost sm" href="#/budget">목표 정하기</a></div>
      <ul class="goal-rows">${goals.map((g) => { const st = goalStatus(g.got, g.goal); return `<li>
        <div class="bt-line"><span class="cat-name"><i class="dot" style="background:${g.c.color}"></i>${esc(g.c.name)}</span><b>${won(g.got)}</b><span class="muted"> / ${won(g.goal)}</span>
          <span class="bt-left goal-${st.state}">${st.state === "done" ? "목표 달성" : `${won(g.goal - g.got)} 남음`}</span></div>
        <div class="meter goal ${st.state}"><span style="width:${Math.min(100, st.ratio * 100)}%"></span></div></li>`; }).join("")}</ul></section>` : ""}

    ${fixed.length ? `<section class="fixed-section"><div class="section-head"><h3>고정 수입·지출</h3><a class="btn ghost sm" href="#/budget?to=fixed">관리</a></div>
      <ul class="fixed-rows">${fixed.map(({ r, tx }) => `<li class="${tx ? "done" : ""}">
        <span class="fx-day">${Number(recurringDay(r, m).slice(8))}일</span>
        <span class="fx-name">${esc(r.name)}<span class="muted small">${esc(accOf(r.account_id)?.name ?? "")}</span></span>
        <span class="fx-state small">${tx ? (r.kind === "income" ? "들어옴" : "나감") : "예정"}</span>
        <span class="fx-amt ${r.kind}">${signedWon(r.kind === "income" ? r.amount : -r.amount)}</span></li>`).join("")}</ul>
      <p class="muted small">이 달 고정 수입 ${won(ft.income)} · 고정 지출 ${won(ft.expense)}${ft.saving ? ` · 고정 저축 ${won(ft.saving)}` : ""}</p></section>` : ""}

    <section class="donuts" aria-label="지출·수입 비율">
      ${donut("지출", s.expense, [...rows.map((r) => ({ name: r.c.name, color: r.c.color, value: r.spent })), { name: "분류 없음", color: "var(--border)", value: none }])}
      ${donut("수입", s.income, [...incomeRows.map((r) => ({ name: r.c.name, color: r.c.color, value: r.amt })), { name: "분류 없음", color: "var(--border)", value: incomeNone }])}
    </section>
    ${catDetails({ key: "expense", title: "분류별 지출", m, total: s.expense, rows: rows.map((r) => ({ c: r.c, amt: r.spent, before: r.before, budget: r.budget })), none })}
    ${catDetails({ key: "income", title: "분류별 수입", m, total: s.income, none: incomeNone, rows: incomeRows })}

    ${txs.length ? `<section class="recent"><div class="section-head"><h3>최근 내역</h3><a class="btn ghost sm" href="#/list?m=${m}">전체 보기</a></div>${txList(txs.slice(0, 6))}</section>` : ""}`);
  bindTxRows();
}

/** 원그래프 (도넛): 큰 분류 5개 + 나머지는 '그 밖' */
function donut(title, total, slices) {
  let list = slices.filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  if (list.length > 6) {
    const rest = list.slice(5).reduce((sum, x) => sum + x.value, 0);
    list = [...list.slice(0, 5), { name: "그 밖", color: "var(--muted-fg)", value: rest }];
  }
  const R = 46, C = 2 * Math.PI * R, sum = list.reduce((a, x) => a + x.value, 0);
  let acc = 0;
  const arcs = list.map((x) => {
    const len = (x.value / sum) * C, gap = list.length > 1 ? Math.min(1.5, len / 3) : 0;
    const arc = `<circle cx="60" cy="60" r="${R}" fill="none" stroke="${x.color}" stroke-width="18" stroke-dasharray="${Math.max(0, len - gap)} ${C}" stroke-dashoffset="${-acc}" transform="rotate(-90 60 60)"><title>${esc(x.name)} ${won(x.value)}</title></circle>`;
    acc += len;
    return arc;
  }).join("");
  return `<figure class="donut">
    <figcaption>${title}</figcaption>
    <div class="donut-body">
      <svg viewBox="0 0 120 120" role="img" aria-label="${title} ${won(total)}${list.map((x) => `, ${x.name} ${Math.round((x.value / sum) * 100)}%`).join("")}">
        <circle cx="60" cy="60" r="${R}" fill="none" stroke="var(--muted)" stroke-width="18"/>${sum ? arcs : ""}
        <text x="60" y="66" text-anchor="middle" class="d-total">${total >= 10000 ? `${Math.round(total / 1000) / 10}만` : total.toLocaleString("ko-KR")}</text>
      </svg>
      ${sum ? `<ul class="d-legend">${list.map((x) => `<li><i style="background:${x.color}"></i><span>${esc(x.name)}</span><b>${Math.round((x.value / sum) * 100)}%</b></li>`).join("")}</ul>`
        : `<p class="muted small">이 달의 ${title}이 없어요</p>`}
    </div>
  </figure>`;
}

/** 분류별 지출·수입: 눌러서 펼치고 접음 (펼친 상태는 이 기기에 기억) */
function catDetails({ key, title, m, total, rows, none }) {
  const income = key === "income";
  const max = Math.max(1, none, ...rows.map((r) => Math.max(r.amt, r.budget ?? 0)));
  const pct = (n) => Math.min(100, (n / max) * 100);
  const open = remember(`money-open-${key}`) === "1";
  const count = rows.filter((r) => r.amt).length + (none ? 1 : 0);
  const body = rows.length || none ? `<ul class="cat-rows">${rows.map((r) => {
      const st = income ? goalStatus(r.amt, r.budget) : budgetStatus(r.amt, r.budget), ch = changeRate(r.amt, r.before);
      const color = income ? r.c.color : st.state === "over" ? "var(--danger)" : st.state === "warn" ? "var(--warn)" : r.c.color;
      return `<li><a href="#/list?m=${m}&c=${r.c.id}">
        <span class="cat-name"><i class="dot" style="background:${r.c.color}"></i>${esc(r.c.name)}</span>
        <span class="cat-amt">${won(r.amt)}${r.budget ? `<span class="muted"> / ${won(r.budget)}${income ? " 목표" : ""}</span>` : ""}</span>
        <span class="cat-bar ${st.state}"><span style="width:${pct(r.amt)}%;background:${color}"></span>${r.budget ? `<i class="cap" style="left:${pct(r.budget)}%"></i>` : ""}</span>
        <span class="cat-ch muted small">${ch === null ? "" : ch === 0 ? "지난달과 같음" : `지난달보다 ${ch > 0 ? "+" : ""}${ch}%`}</span>
      </a></li>`;
    }).join("")}
    ${none ? `<li><a href="#/list?m=${m}&c=none&k=${key}"><span class="cat-name"><i class="dot" style="background:var(--border)"></i>분류 없음</span><span class="cat-amt">${won(none)}</span><span class="cat-bar"><span style="width:${pct(none)}%;background:var(--muted-fg)"></span></span><span class="cat-ch muted small">눌러서 분류하기</span></a></li>` : ""}
    </ul>` : `<p class="empty">이 달의 ${income ? "수입" : "지출"}이 없어요.</p>`;
  return `<details class="cat-section" data-open-key="${key}" ${open ? "open" : ""}>
    <summary><h3>${title}</h3><span class="cat-sum"><b class="${income ? "in" : ""}">${won(total)}</b><span class="muted small">${count ? `${count}개 분류` : ""}</span></span></summary>
    ${body}
  </details>`;
}
document.addEventListener("toggle", (e) => {
  const key = e.target.dataset?.openKey;
  if (key) remember(`money-open-${key}`, e.target.open ? "1" : "0");
}, true);

/* ---------- 내역 ---------- */
function txRow(t) {
  const c = catOf(t.category_id), a = accOf(t.account_id);
  const title = t.place || c?.name || t.tx_type || kindName(t.kind);
  const tag = (t.recurring_id ? '<span class="tag fixed">고정</span>' : "") + (t.kind === "expense" || t.kind === "income" ? "" : `<span class="tag ${t.kind}">${kindName(t.kind)}</span>`);
  return `<li><button type="button" class="tx" data-tx="${t.id}">
    <span class="tx-cat" style="--c:${c?.color ?? "var(--border)"}">${esc(c?.name ?? "분류 없음")}</span>
    <span class="tx-main"><b>${esc(title)}</b><span class="muted small">${kstTime(t.occurred_at)} · ${esc(a?.name ?? "")}${t.memo ? ` · ${esc(t.memo)}` : ""}${t.source === "manual" ? " · 직접 입력" : ""}</span></span>
    <span class="tx-amt ${t.kind}">${tag}${signedWon(t.amount)}</span>
  </button></li>`;
}
function txList(txs) {
  const days = [...new Set(txs.map((t) => kstDay(t.occurred_at)))];
  return days.map((d) => {
    const list = txs.filter((t) => kstDay(t.occurred_at) === d);
    const out = list.filter((t) => t.kind === "expense").reduce((s, t) => s - t.amount, 0);
    return `<div class="day"><h4>${dayLabel(d)}${out ? `<span>지출 ${won(out)}</span>` : ""}</h4><ul class="tx-list">${list.map(txRow).join("")}</ul></div>`;
  }).join("");
}
let shown = [];
function bindTxRows() {
  $$("[data-tx]").forEach((b) => b.onclick = () => txDialog(shown.find((t) => t.id === b.dataset.tx)));
}

async function renderList(params) {
  const m = params.get("m") || thisMonth();
  document.title = `내역 ${monthLabel(m)} — $TDL`;
  app.innerHTML = shell("/list", loading());
  bindShell();
  const txs = await loadMonth(m);
  shown = txs;
  fill(`${monthNav("/list", m)}
    <div class="filters">
      <input class="input" id="q" type="search" placeholder="어디서, 메모 검색" aria-label="내역 검색" value="${esc(params.get("q") ?? "")}">
      <select class="input" id="f-acc" aria-label="계좌"><option value="">모든 계좌</option>${base.accounts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select>
      <select class="input" id="f-cat" aria-label="분류"><option value="">모든 분류</option><option value="none">분류 없음</option>${base.categories.map((c) => `<option value="${c.id}" ${params.get("c") === c.id ? "selected" : ""}>${kindName(c.kind)} · ${esc(c.name)}</option>`).join("")}</select>
      <select class="input" id="f-kind" aria-label="종류"><option value="">모든 종류</option>${KINDS.map((k) => `<option value="${k.id}">${k.name}</option>`).join("")}</select>
    </div>
    <p class="muted small" id="count"></p>
    <div id="rows"></div>`);
  if (params.get("c") === "none") $("#f-cat").value = "none";
  if (params.get("k")) $("#f-kind").value = params.get("k");
  const draw = () => {
    const q = $("#q").value.trim().toLowerCase(), acc = $("#f-acc").value, cat = $("#f-cat").value, kind = $("#f-kind").value;
    const list = txs.filter((t) => (!q || `${t.place} ${t.memo} ${t.tx_type}`.toLowerCase().includes(q)) && (!acc || t.account_id === acc)
      && (!cat || (cat === "none" ? !t.category_id && t.kind === (kind || "expense") : t.category_id === cat)) && (!kind || t.kind === kind));
    const out = list.filter((t) => t.kind === "expense").reduce((s, t) => s - t.amount, 0), inc = list.filter((t) => t.kind === "income").reduce((s, t) => s + t.amount, 0);
    $("#count").textContent = `${list.length}건 · 지출 ${won(out)} · 수입 ${won(inc)}`;
    $("#rows").innerHTML = list.length ? txList(list) : '<p class="empty">내역이 없어요.</p>';
    bindTxRows();
  };
  ["q", "f-acc", "f-cat", "f-kind"].forEach((id) => $(`#${id}`).addEventListener("input", draw));
  draw();
}

/* ---------- 빠른 입력 / 고치기 ---------- */
async function txDialog(tx) {
  const editing = !!tx;
  let kind = tx?.kind ?? "expense";
  const lastAcc = remember("money-last-account");
  const acc0 = tx?.account_id ?? (accOf(lastAcc) ? lastAcc : base.accounts[0]?.id);
  let freq = [];
  if (!editing) {
    const { data } = await sb.from("money_transactions").select("place, category_id, amount, kind").eq("source", "manual").order("created_at", { ascending: false }).limit(200);
    freq = frequentEntries(data ?? []);
  }
  const dlg = document.createElement("dialog");
  dlg.className = "tx-dialog";
  const kinds = KINDS.filter((k) => k.id !== "cancel" || kind === "cancel");
  dlg.innerHTML = `<form method="dialog" id="tx-form">
    <h2>${editing ? "내역 고치기" : "빠른 입력"}</h2>
    <button class="btn ghost sm dialog-close" type="button" value="cancel" aria-label="닫기">닫기</button>
    <div class="seg" role="tablist">${kinds.map((k) => `<button type="button" role="tab" data-kind="${k.id}" aria-selected="${k.id === kind}" ${editing && tx.pair_id && k.id !== kind ? "disabled" : ""}>${k.name}</button>`).join("")}</div>
    <label class="amount-field"><span class="sr">금액</span><input class="input" id="t-amount" inputmode="numeric" autocomplete="off" placeholder="0" value="${tx ? Math.abs(tx.amount).toLocaleString("ko-KR") : ""}" required><span>원</span></label>
    ${freq.length ? `<div class="chips freq" id="freq">${freq.map((f, i) => `<button type="button" class="chip-btn" data-f="${i}">${esc(f.place)}</button>`).join("")}</div>` : ""}
    <div class="chips" id="t-cats"></div>
    <div class="grid2">
      <label class="field" id="acc-field"><span id="acc-label">계좌</span><select class="input" id="t-acc">${base.accounts.map((a) => `<option value="${a.id}" ${a.id === acc0 ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label>
      <label class="field" id="to-field" hidden>받는 계좌<select class="input" id="t-to">${base.accounts.map((a, i) => `<option value="${a.id}" ${i === 1 ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label>
      <label class="field">언제<input class="input" type="datetime-local" id="t-at" value="${toLocalInput(tx?.occurred_at ?? new Date().toISOString())}" required></label>
      <label class="field">어디서 · 누구<input class="input" id="t-place" value="${esc(tx?.place ?? "")}" placeholder="예: 스타벅스, 엄마"></label>
      <label class="field">메모<input class="input" id="t-memo" value="${esc(tx?.memo ?? "")}"></label>
    </div>
    <label class="check" id="rule-wrap" hidden><input type="checkbox" id="t-rule" checked> <span id="rule-text"></span></label>
    ${tx?.source === "import" ? `<p class="muted small">은행 파일에서 가져온 내역이에요${tx.tx_type ? ` (${esc(tx.tx_type)})` : ""}. 금액·계좌·시각은 파일 기준이라 고칠 수 없어요.</p>` : ""}
    <div class="actions">${editing ? '<button class="btn ghost danger" type="button" id="t-del">삭제</button><span style="flex:1"></span>' : ""}<button class="btn primary" type="submit" id="t-save">저장</button></div>
  </form>`;
  document.body.append(dlg);
  let cat = tx?.category_id ?? null;
  const imported = tx?.source === "import";
  if (imported) { $("#t-amount", dlg).readOnly = true; $("#t-acc", dlg).disabled = true; $("#t-at", dlg).readOnly = true; }

  const drawCats = () => {
    const list = base.categories.filter((c) => c.kind === (kind === "cancel" ? "expense" : kind));
    if (cat && !list.some((c) => c.id === cat)) cat = null;
    if (!cat && (kind === "transfer" || kind === "saving")) cat = list[0]?.id ?? null;
    $("#t-cats", dlg).innerHTML = list.map((c) => `<button type="button" class="chip-btn cat" data-c="${c.id}" aria-pressed="${c.id === cat}" style="--c:${c.color}">${esc(c.name)}</button>`).join("");
    $$("[data-c]", dlg).forEach((b) => b.onclick = () => { cat = cat === b.dataset.c ? null : b.dataset.c; drawCats(); drawRule(); });
    const transferNew = kind === "transfer" && !editing;
    $("#to-field", dlg).hidden = !transferNew;
    $("#acc-label", dlg).textContent = transferNew ? "보내는 계좌" : "계좌";
  };
  // 같은 곳의 지난 내역 (분류 규칙을 정하면 함께 바꿈)
  let samePlace = [];
  const { data: all } = await sb.from("money_transactions").select("id, place, kind, category_id, pair_id");
  const sameAs = (place) => (all ?? []).filter((t) => t.id !== tx?.id && !t.pair_id && t.kind !== "cancel" && normalizePlace(t.place) === normalizePlace(place));
  const drawRule = () => {
    const place = $("#t-place", dlg).value.trim();
    const show = !!place && !!cat && (!editing || cat !== tx.category_id || kind !== tx.kind);
    $("#rule-wrap", dlg).hidden = !show;
    if (!show) return;
    samePlace = sameAs(place).filter((t) => t.category_id !== cat || t.kind !== kind);
    const name = catOf(cat)?.name ?? "";
    $("#rule-text", dlg).textContent = samePlace.length
      ? `'${place}' 지난 내역 ${samePlace.length}건도 ${name}(으)로 바꾸고, 다음부터도 ${name}(으)로 분류`
      : `다음부터 '${place}'은(는) ${name}(으)로 분류`;
  };
  $$("[data-kind]", dlg).forEach((b) => b.onclick = () => {
    kind = b.dataset.kind;
    $$("[data-kind]", dlg).forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    drawCats(); drawRule();
  });
  $$("[data-f]", dlg).forEach((b) => b.onclick = () => {
    const f = freq[Number(b.dataset.f)];
    $("#t-place", dlg).value = f.place; cat = f.category_id;
    if (!$("#t-amount", dlg).value) $("#t-amount", dlg).value = f.amount.toLocaleString("ko-KR");
    drawCats(); drawRule();
  });
  // 금액은 입력하는 대로 쉼표를 붙임
  $("#t-amount", dlg).addEventListener("input", (e) => {
    const n = parseAmount(e.target.value.replace(/[^\d]/g, ""));
    e.target.value = n ? n.toLocaleString("ko-KR") : "";
  });
  $("#t-place", dlg).addEventListener("input", drawRule);
  drawCats(); drawRule();

  $(".dialog-close", dlg).onclick = () => dlg.close();
  dlg.addEventListener("close", () => dlg.remove());
  $("#t-del", dlg)?.addEventListener("click", async () => {
    if (!confirm(tx.pair_id ? "이 이체의 양쪽 내역을 모두 지울까요?" : "이 내역을 지울까요?")) return;
    const q = sb.from("money_transactions").delete();
    const { error } = await (tx.pair_id ? q.eq("pair_id", tx.pair_id) : q.eq("id", tx.id));
    if (error) { toast("지우지 못했어요.", "error"); return; }
    dlg.close(); toast("지웠어요"); rerender();
  });
  $("#tx-form", dlg).onsubmit = async (e) => {
    e.preventDefault();
    const n = parseAmount($("#t-amount", dlg).value);
    if (!n || n <= 0) { toast("금액을 넣어 주세요.", "error"); return; }
    const sign = kind === "income" ? 1 : kind === "cancel" ? Math.sign(tx.amount) : -1;
    const place = $("#t-place", dlg).value.trim(), memo = $("#t-memo", dlg).value.trim();
    const at = fromLocalInput($("#t-at", dlg).value), acc = $("#t-acc", dlg).value;
    $("#t-save", dlg).disabled = true;
    let error;
    if (editing) {
      const patch = { kind, category_id: cat, place, memo };
      if (!imported) Object.assign(patch, { amount: sign * n, account_id: acc, occurred_at: at });
      ({ error } = await sb.from("money_transactions").update(patch).eq("id", tx.id));
    } else if (kind === "transfer") {
      const to = $("#t-to", dlg).value;
      if (to === acc) { $("#t-save", dlg).disabled = false; toast("보내는 계좌와 받는 계좌가 같아요.", "error"); return; }
      const pair_id = crypto.randomUUID();
      ({ error } = await sb.from("money_transactions").insert([
        { account_id: acc, occurred_at: at, amount: -n, kind, category_id: cat, place: place || accOf(to)?.name || "", memo, pair_id },
        { account_id: to, occurred_at: at, amount: n, kind, category_id: cat, place: place || accOf(acc)?.name || "", memo, pair_id },
      ]));
    } else {
      ({ error } = await sb.from("money_transactions").insert({ account_id: acc, occurred_at: at, amount: sign * n, kind, category_id: cat, place, memo }));
    }
    if (error) { $("#t-save", dlg).disabled = false; toast("저장하지 못했어요.", "error"); return; }
    if (!$("#rule-wrap", dlg).hidden && $("#t-rule", dlg).checked) {
      const key = normalizePlace(place);
      const old = base.rules.find((r) => r.place === key);
      if (old) await sb.from("money_rules").update({ kind: kind === "cancel" ? "expense" : kind, category_id: cat }).eq("id", old.id);
      else await sb.from("money_rules").insert({ place: key, kind: kind === "cancel" ? "expense" : kind, category_id: cat });
      const ruleKind = kind === "cancel" ? "expense" : kind;
      for (let i = 0; i < samePlace.length; i += 100) {
        await sb.from("money_transactions").update({ kind: ruleKind, category_id: cat }).in("id", samePlace.slice(i, i + 100).map((t) => t.id));
      }
      if (samePlace.length) toast(`같은 곳 내역 ${samePlace.length}건도 바꿨어요`);
    }
    remember("money-last-account", acc);
    dlg.close();
    toast(editing ? "고쳤어요" : `${kindName(kind)} ${won(n)} 넣었어요`);
    rerender();
  };
  dlg.showModal();
  if (!editing) $("#t-amount", dlg).focus();
}

/* ---------- 계좌 ---------- */
async function renderAccounts() {
  document.title = "계좌 — $TDL";
  app.innerHTML = shell("/accounts", loading());
  bindShell();
  const { data } = await sb.from("money_transactions").select("account_id, amount, balance_after, occurred_at, source");
  const all = data ?? [];
  const lastImport = (id) => all.filter((t) => t.account_id === id && t.source === "import").map((t) => t.occurred_at).sort().at(-1);
  const sum = base.accounts.reduce((s, a) => s + accountBalance(a, all), 0);
  fill(`<p class="total-balance"><span class="muted">모든 계좌</span><b>${won(sum)}</b></p>
    <ul class="accounts">${base.accounts.map((a) => {
      const li = lastImport(a.id);
      return `<li class="paper" data-id="${a.id}">
        <div class="acc-head"><span class="bank b-${a.bank}">${esc(BANKS.find((b) => b.id === a.bank)?.name ?? "")}</span><b>${esc(a.name)}</b></div>
        <p class="acc-bal">${won(accountBalance(a, all))}</p>
        <p class="muted small">${li ? `파일로 ${kstDay(li).replaceAll("-", ".")}까지 가져옴` : a.bank === "cash" ? "직접 입력으로 관리" : "아직 가져온 파일이 없어요"}</p>
        <details><summary class="small">고치기</summary>
          <form class="acc-edit grid2">
            <label class="field">이름<input class="input" name="name" value="${esc(a.name)}" required></label>
            <label class="field">시작 잔액 <span class="muted">(파일 잔액이 없을 때)</span><input class="input" name="opening" inputmode="numeric" value="${a.opening_balance ?? 0}"></label>
            <div class="add-as"><button class="btn primary sm" type="submit">저장</button><button class="btn ghost sm danger" type="button" data-del>계좌 삭제</button></div>
          </form></details>
      </li>`;
    }).join("")}</ul>
    <form class="paper acc-add" id="acc-add">
      <h3>계좌 추가</h3>
      <div class="grid2">
        <label class="field">은행<select class="input" name="bank">${BANKS.map((b) => `<option value="${b.id}">${b.name}</option>`).join("")}</select></label>
        <label class="field">이름<input class="input" name="name" placeholder="예: 하나 월급통장" required></label>
        <label class="field">시작 잔액<input class="input" name="opening" inputmode="numeric" value="0"></label>
      </div>
      <div><button class="btn outline" type="submit">추가</button></div>
    </form>`);
  $$(".accounts li").forEach((li) => {
    const a = accOf(li.dataset.id);
    $(".acc-edit", li).onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      await sb.from("money_accounts").update({ name: f.name.value.trim(), opening_balance: parseAmount(f.opening.value) ?? 0 }).eq("id", a.id);
      toast("저장했어요"); rerender();
    };
    $("[data-del]", li).onclick = async () => {
      if (!confirm(`'${a.name}' 계좌를 지울까요? 이 계좌의 내역도 모두 지워져요.`)) return;
      await sb.from("money_accounts").delete().eq("id", a.id);
      toast("지웠어요"); rerender();
    };
  });
  $("#acc-add").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const { error } = await sb.from("money_accounts").insert({ bank: f.bank.value, name: f.name.value.trim(), opening_balance: parseAmount(f.opening.value) ?? 0, sort: base.accounts.length });
    if (error) { toast("추가하지 못했어요.", "error"); return; }
    toast("계좌를 추가했어요"); rerender();
  };
}

/* ---------- 예산·분류 ---------- */
async function renderBudget(params = new URLSearchParams()) {
  document.title = "예산·분류 — $TDL";
  app.innerHTML = shell("/budget", loading());
  bindShell();
  const budgetOf = (id) => base.budgets.find((b) => (b.category_id ?? null) === id)?.amount ?? "";
  const fmt = (v) => (v ? Number(v).toLocaleString("ko-KR") : "");
  fill(`<form class="paper budget-form" id="budget-form">
      <div class="section-head"><h3>한 달 예산</h3><span class="muted small">매달 같은 금액이 적용돼요. 비워 두면 예산 없음</span></div>
      <label class="budget-row total"><span>전체 지출</span><span class="money-input"><input class="input" inputmode="numeric" data-b="" value="${fmt(budgetOf(null))}" placeholder="예: 800,000"><span>원</span></span></label>
      ${base.categories.filter((c) => c.kind === "expense").map((c) => `<label class="budget-row"><span><i class="dot" style="background:${c.color}"></i>${esc(c.name)}</span>
        <span class="money-input"><input class="input" inputmode="numeric" data-b="${c.id}" value="${fmt(budgetOf(c.id))}"><span>원</span></span></label>`).join("")}
      <p class="muted small" id="b-sum"></p>
      ${["income", "saving"].map((k) => `<div class="section-head goal-head"><h3>${k === "income" ? "한 달 수입 목표" : "한 달 저축 목표"}</h3><span class="muted small">채울수록 막대가 차요</span></div>
        ${base.categories.filter((c) => c.kind === k).map((c) => `<label class="budget-row"><span><i class="dot" style="background:${c.color}"></i>${esc(c.name)}</span>
          <span class="money-input"><input class="input" inputmode="numeric" data-g="${c.id}" value="${fmt(budgetOf(c.id))}"><span>원</span></span></label>`).join("") || '<p class="empty-hint">아래 분류에서 먼저 분류를 만들어 주세요.</p>'}`).join("")}
      <div class="actions"><button class="btn primary" type="submit">예산·목표 저장</button></div>
    </form>

    <section class="paper fixed-manage" id="fixed">
      <div class="section-head"><h3>고정 수입·지출</h3><span class="muted small">매월 정한 날이 되면 내역이 자동으로 들어가요</span></div>
      ${base.recurring.length ? `<ul class="fixed-list">${base.recurring.map((r) => `<li data-r="${r.id}">
        <span class="tag ${r.kind}">${kindName(r.kind)}</span>
        <span class="fx-name"><b>${esc(r.name)}</b><span class="muted small">매월 ${r.day}일 · ${esc(accOf(r.account_id)?.name ?? "")} · ${esc(catOf(r.category_id)?.name ?? "분류 없음")} · ${r.start_month.replace("-", ".")}~${r.end_month ? r.end_month.replace("-", ".") : "계속"}</span></span>
        <span class="fx-amt ${r.kind}">${won(r.amount)}</span>
        <button class="btn ghost sm danger" type="button">그만두기</button></li>`).join("")}</ul>` : '<p class="empty-hint">아직 고정 항목이 없어요. 용돈, 월세, 구독료처럼 매달 같은 돈을 넣어 보세요.</p>'}
      <form class="fixed-add" id="fixed-add">
        <div class="grid2">
          <label class="field">이름<input class="input" name="name" placeholder="예: 용돈, 월세" required></label>
          <label class="field">종류<select class="input" name="kind"><option value="income">수입</option><option value="expense" selected>지출</option><option value="saving">저축</option></select></label>
          <label class="field">금액<input class="input" name="amount" inputmode="numeric" placeholder="예: 300,000" required></label>
          <label class="field">분류<select class="input" name="category"></select></label>
          <label class="field">계좌<select class="input" name="account">${base.accounts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select></label>
          <label class="field">매월 며칠<input class="input" name="day" type="number" min="1" max="31" value="1" required></label>
          <label class="field">시작 월<input class="input" name="start" type="month" value="${thisMonth()}" required></label>
          <label class="field">끝 월 <span class="muted">(비우면 계속)</span><input class="input" name="end" type="month"></label>
        </div>
        <p class="muted small">31일처럼 그 달에 없는 날은 그 달 마지막 날에 들어가요. 은행 파일을 가져올 때 같은 금액이 이틀 안에 있으면 하나로 합쳐져요.</p>
        <div><button class="btn outline" type="submit">고정 항목 추가</button></div>
      </form>
    </section>

    <section class="paper cats-manage">
      <div class="section-head"><h3>분류</h3><span class="muted small">이름과 색을 바꾸면 바로 저장돼요</span></div>
      ${KINDS.filter((k) => k.id !== "cancel").map((k) => `<h4>${k.name}</h4><ul class="label-list">${base.categories.filter((c) => c.kind === k.id).map((c) => `<li data-id="${c.id}">
        <input type="color" value="${c.color}" aria-label="${esc(c.name)} 색"><input class="input" value="${esc(c.name)}" aria-label="분류 이름"><button class="btn ghost sm danger" type="button">삭제</button></li>`).join("")}</ul>`).join("")}
      <form class="label-add" id="cat-add"><input type="color" value="#5c7cfa" aria-label="새 분류 색"><select class="input" style="width:auto;min-width:96px" aria-label="새 분류 종류">${KINDS.filter((k) => k.id !== "cancel").map((k) => `<option value="${k.id}">${k.name}</option>`).join("")}</select><input class="input" placeholder="새 분류 이름" aria-label="새 분류 이름" required><button class="btn primary" type="submit">추가</button></form>
    </section>`);
  const sumDraw = () => {
    const parts = $$("[data-b]").filter((i) => i.dataset.b).reduce((s, i) => s + (parseAmount(i.value) ?? 0), 0);
    const total = parseAmount($('[data-b=""]').value) ?? 0;
    $("#b-sum").textContent = parts ? `분류별 예산 합계 ${won(parts)}${total ? (parts > total ? ` · 전체 예산보다 ${won(parts - total)} 많아요` : ` · 전체 예산 중 ${won(total - parts)}는 분류를 정하지 않은 돈`) : ""}` : "";
  };
  $$("[data-b]").forEach((i) => i.addEventListener("input", () => { const n = parseAmount(i.value.replace(/[^\d]/g, "")); i.value = n ? n.toLocaleString("ko-KR") : ""; sumDraw(); }));
  sumDraw();
  if (params.get("to") === "fixed") $("#fixed").scrollIntoView();
  $$("[data-g]").forEach((i) => i.addEventListener("input", () => { const n = parseAmount(i.value.replace(/[^\d]/g, "")); i.value = n ? n.toLocaleString("ko-KR") : ""; }));
  // 고정 항목: 종류에 맞는 분류만
  const fa = $("#fixed-add");
  const drawFixedCats = () => { fa.category.innerHTML = '<option value="">분류 없음</option>' + base.categories.filter((c) => c.kind === fa.kind.value).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join(""); };
  fa.kind.onchange = drawFixedCats; drawFixedCats();
  fa.amount.addEventListener("input", () => { const n = parseAmount(fa.amount.value.replace(/[^\d]/g, "")); fa.amount.value = n ? n.toLocaleString("ko-KR") : ""; });
  fa.onsubmit = async (e) => {
    e.preventDefault();
    const amount = parseAmount(fa.amount.value);
    if (!amount || amount <= 0) { toast("금액을 넣어 주세요.", "error"); return; }
    if (fa.end.value && fa.end.value < fa.start.value) { toast("끝 월이 시작 월보다 빨라요.", "error"); return; }
    const { error } = await sb.from("money_recurring").insert({ name: fa.name.value.trim(), kind: fa.kind.value, amount, category_id: fa.category.value || null,
      account_id: fa.account.value, day: Number(fa.day.value), start_month: fa.start.value, end_month: fa.end.value || null });
    if (error) { toast("추가하지 못했어요. 데이터베이스 설정(money.sql)을 확인해 주세요.", "error"); return; }
    toast("고정 항목을 추가했어요"); rerender();
  };
  $$(".fixed-list li[data-r]").forEach((li) => $("button", li).onclick = async () => {
    const r = base.recurring.find((x) => x.id === li.dataset.r);
    if (!confirm(`'${r.name}' 고정 항목을 그만둘까요? 이미 들어간 내역은 그대로 남아요.`)) return;
    await sb.from("money_recurring").delete().eq("id", r.id);
    toast("그만뒀어요"); rerender();
  });
  $("#budget-form").onsubmit = async (e) => {
    e.preventDefault();
    for (const i of [...$$("[data-b]"), ...$$("[data-g]")]) {
      const id = (i.dataset.b ?? i.dataset.g) || null, n = parseAmount(i.value) ?? 0;
      const old = base.budgets.find((b) => (b.category_id ?? null) === id);
      if (old && !n) await sb.from("money_budgets").delete().eq("id", old.id);
      else if (old && n !== Number(old.amount)) await sb.from("money_budgets").update({ amount: n }).eq("id", old.id);
      else if (!old && n) await sb.from("money_budgets").insert({ category_id: id, amount: n });
    }
    toast("예산·목표를 저장했어요"); go("#/", true);
  };
  $$(".cats-manage li[data-id]").forEach((li) => {
    const id = li.dataset.id, c = catOf(id);
    const [color, name] = $$("input", li);
    color.onchange = async () => { await sb.from("money_categories").update({ color: color.value }).eq("id", id); };
    name.onblur = async () => { const v = name.value.trim(); if (v && v !== c.name) { await sb.from("money_categories").update({ name: v }).eq("id", id); c.name = v; toast("이름을 바꿨어요"); } };
    $("button", li).onclick = async () => {
      if (!confirm(`'${c.name}' 분류를 지울까요? 이 분류였던 내역은 '분류 없음'이 돼요.`)) return;
      await sb.from("money_categories").delete().eq("id", id);
      rerender();
    };
  });
  $("#cat-add").onsubmit = async (e) => {
    e.preventDefault();
    const [color, kind, name] = [$("#cat-add input[type=color]"), $("#cat-add select"), $("#cat-add .input:not(select)")];
    await sb.from("money_categories").insert({ name: name.value.trim(), kind: kind.value, color: color.value, sort: base.categories.length });
    toast("분류를 추가했어요"); rerender();
  };
}

/* ---------- 가져오기 ---------- */
// 엑셀 파일은 이 화면에서만 필요하므로 그때 불러옴 (SheetJS)
async function loadXlsx() {
  if (window.XLSX) return window.XLSX;
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = window.__XLSX_URL__ ?? "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
    s.onload = res; s.onerror = () => rej(new Error("엑셀 읽기 도구를 불러오지 못했어요."));
    document.head.append(s);
  });
  return window.XLSX;
}

async function renderImport() {
  document.title = "가져오기 — $TDL";
  app.innerHTML = shell("/import", loading());
  bindShell();
  const def = base.accounts.find((a) => a.bank === "kakao") ?? base.accounts[0];
  fill(`<section class="paper import-card">
      <h3>은행 거래내역 파일 올리기</h3>
      <p class="muted small">은행 앱이나 인터넷뱅킹에서 거래내역을 엑셀(xlsx)이나 CSV로 받아 올려 주세요. 파일은 이 브라우저 안에서만 읽고, 날짜·금액·잔액·거래구분·내용만 저장해요. 계좌번호는 저장하지 않아요.</p>
      <div class="grid2">
        <label class="field">어느 계좌의 파일인가요?<select class="input" id="i-acc">${base.accounts.filter((a) => a.bank !== "cash").map((a) => `<option value="${a.id}" ${a.id === def?.id ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label>
        <label class="field">파일<input class="input" type="file" id="i-file" accept=".xlsx,.xls,.csv"></label>
      </div>
      <p class="muted small">같은 파일이나 기간이 겹치는 파일을 다시 올려도, 이미 있는 내역은 건너뛰어요.</p>
    </section>
    <section class="paper import-card">
      <h3>거래내역 캡처 올리기</h3>
      <p class="muted small">은행 앱의 거래내역 목록(몇 시에 누구에게 얼마)을 캡처해 올리면 읽어서 표로 만들어 드려요. 위에서 고른 계좌로 들어가요. 저장하기 전에 한 번 확인하고 고칠 수 있어요.</p>
      <label class="field">캡처 (여러 장 가능)<input class="input" type="file" id="i-shot" accept="image/*" multiple></label>
      <p class="muted small">캡처는 읽는 데만 쓰고 저장하지 않아요. 긴 캡처는 나눠서 읽어요.</p>
    </section>
    <div id="preview"></div>`);
  $("#i-shot").onchange = async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    if (!files.length) return;
    const box = $("#preview");
    box.innerHTML = `<div class="paper notice"><h2>캡처를 읽는 중…</h2><p>장 수에 따라 10초~1분쯤 걸려요.</p></div>`;
    try {
      const images = await shotPieces(files);
      const { data, error } = await sb.functions.invoke("money-ocr", { body: { images } });
      if (error || data?.error) {
        let msg = data?.error;
        try { msg = msg ?? (await error.context.json()).error; } catch { /* 메시지 없음 */ }
        throw new Error(msg || "캡처를 읽지 못했어요. 잠시 뒤 다시 해 주세요.");
      }
      const items = fromScreenshotRows(data.items);
      if (!items.length) throw new Error("캡처에서 거래를 찾지 못했어요. 거래내역 목록 화면인지 확인해 주세요.");
      reviewShots(box, $("#i-acc").value, items);
    } catch (err) {
      box.innerHTML = `<div class="paper notice"><h2>읽지 못했어요</h2><p>${esc(err.message)}</p></div>`;
    }
  };
  $("#i-file").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const box = $("#preview");
    box.innerHTML = loading();
    try {
      const XLSX = await loadXlsx();
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" });
      const { error, items } = parseBankRows(rows);
      if (error) { box.innerHTML = `<div class="paper notice"><h2>읽지 못했어요</h2><p>${esc(error)}</p></div>`; return; }
      await previewImport(box, $("#i-acc").value, items);
    } catch (err) {
      box.innerHTML = `<div class="paper notice"><h2>읽지 못했어요</h2><p>${esc(err.message)}</p></div>`;
    }
  };
}

// 캡처 → 보낼 이미지 조각: 가로 1000px까지 줄이고, 긴 캡처는 위아래로 조금 겹치게 잘라 글자가 작아지지 않게 함
const SHOT_W = 1000, SHOT_H = 1600, SHOT_OVERLAP = 160, SHOT_MAX = 8;
async function shotPieces(files) {
  const out = [];
  for (const f of files) {
    const img = await createImageBitmap(f).catch(() => null);
    if (!img) throw new Error(`${f.name}: 이미지를 열지 못했어요.`);
    const scale = Math.min(1, SHOT_W / img.width);
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    for (let y = 0; y < h; y += SHOT_H - SHOT_OVERLAP) {
      const ph = Math.min(SHOT_H, h - y);
      if (y > 0 && ph <= SHOT_OVERLAP) break; // 앞 조각과 겹치는 자투리
      const c = document.createElement("canvas");
      c.width = w; c.height = ph;
      c.getContext("2d").drawImage(img, 0, -y, w, h);
      out.push({ media_type: "image/jpeg", data: c.toDataURL("image/jpeg", 0.9).split(",")[1] });
      if (out.length > SHOT_MAX) throw new Error(`캡처가 너무 길거나 많아요. 한 번에 ${SHOT_MAX}조각까지 읽을 수 있으니 나눠서 올려 주세요.`);
      if (y + ph >= h) break;
    }
  }
  return out;
}

// 캡처에서 읽은 내역을 저장 전에 확인·수정 (잘못 읽은 줄은 고치거나 빼기)
function reviewShots(box, accountId, items) {
  const rows = items.slice().sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  box.innerHTML = `<section class="paper import-card">
    <h3>읽은 내역 확인</h3>
    <p class="muted small">캡처와 비교해 보고 틀린 곳은 고쳐 주세요. 나가는 돈은 −, 들어오는 돈은 +예요. 체크를 끈 줄은 빼고 넘어가요.</p>
    <div class="table-scroll"><table class="import-table shot-table"><thead><tr><th></th><th>날짜</th><th>시각</th><th>누구·어디</th><th class="r">금액</th></tr></thead><tbody>
      ${rows.map((t, i) => `<tr data-i="${i}"><td><input type="checkbox" class="s-on" checked aria-label="이 줄 넣기"></td>
        <td><input class="input s-date" type="date" value="${kstDay(t.occurred_at)}"></td>
        <td><input class="input s-time" type="time" value="${kstTime(t.occurred_at)}"></td>
        <td><input class="input s-place" value="${esc(t.place)}" maxlength="100"></td>
        <td class="r"><input class="input s-amount" inputmode="numeric" value="${t.amount > 0 ? "+" : "−"}${Math.abs(t.amount).toLocaleString("ko-KR")}"></td></tr>`).join("")}
    </tbody></table></div>
    <p class="s-msg small" id="s-msg" role="status"></p>
    <div class="actions"><button class="btn primary" type="button" id="s-next">다음: 중복 확인</button></div>
  </section>`;
  $("#s-next").onclick = async () => {
    const out = [];
    for (const tr of box.querySelectorAll("tbody tr")) {
      if (!tr.querySelector(".s-on").checked) continue;
      const t = rows[tr.dataset.i];
      const at = parseKstDateTime(`${tr.querySelector(".s-date").value} ${tr.querySelector(".s-time").value || "00:00"}`);
      const amount = parseAmount(tr.querySelector(".s-amount").value.replace(/[−–]/g, "-"));
      if (!at || !amount) { $("#s-msg").textContent = "날짜와 금액을 확인해 주세요."; tr.querySelector(at ? ".s-amount" : ".s-date").focus(); return; }
      // 날짜·시각·금액을 고쳤으면 잔액은 맞지 않을 수 있어 뺌
      const same = at === t.occurred_at && amount === t.amount;
      out.push({ ...t, occurred_at: at, amount, place: tr.querySelector(".s-place").value.trim(), balance_after: same ? t.balance_after : null });
    }
    if (!out.length) { $("#s-msg").textContent = "넣을 줄이 없어요."; return; }
    box.innerHTML = loading();
    await previewImport(box, accountId, out);
  };
}

async function previewImport(box, accountId, items) {
  const times = items.map((t) => Date.parse(t.occurred_at));
  const from = new Date(Math.min(...times) - 2 * 86400000).toISOString(), to = new Date(Math.max(...times) + 2 * 86400000).toISOString();
  const { data } = await sb.from("money_transactions").select("*").gte("occurred_at", from).lt("occurred_at", to);
  const existing = data ?? [];
  const keys = new Set(existing.map((t) => t.import_key).filter(Boolean));
  const manuals = existing.filter((t) => t.source === "manual" && !t.pair_id);
  const taken = new Set();
  const fresh = [], merges = [];
  let dup = 0;
  for (const it of items) {
    const key = importKey(accountId, it);
    if (keys.has(key)) { dup++; continue; }
    keys.add(key);
    const t = { ...it, account_id: accountId, import_key: key, source: "import" };
    const m = findManualMatch(t, manuals, taken);
    if (m) { taken.add(m.id); merges.push({ manual: m, t }); continue; }
    fresh.push({ ...t, ...classify(t, base.rules, base.categories), _new: true, id: `new-${fresh.length}` });
  }
  // 취소 짝: 이 계좌의 새 내역과 기존 내역 사이에서
  const pool = [...fresh, ...existing.filter((t) => t.account_id === accountId && t.kind !== "cancel")];
  const cancels = findCancelPairs(pool);
  for (const pair of cancels) for (const t of pair) t.kind = "cancel";
  // 이체 짝: 새 내역과 다른 내 계좌의 내역 사이에서
  const transferPool = [...fresh.filter((t) => t.kind !== "cancel"), ...existing.filter((t) => t.account_id !== accountId && !t.pair_id && t.kind !== "cancel")];
  const transferCat = base.categories.find((c) => c.kind === "transfer")?.id ?? null;
  const transfers = findTransferPairs(transferPool).filter((p) => p.some((t) => t._new));
  for (const pair of transfers) { const pid = crypto.randomUUID(); for (const t of pair) { t.kind = "transfer"; t.category_id = transferCat; t.pair_id = pid; } }

  const show = fresh.slice().sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const tag = (t) => (t.kind === "expense" || t.kind === "income" ? "" : `<span class="tag ${t.kind}">${kindName(t.kind)}</span>`);
  box.innerHTML = `<section class="paper import-card">
    <h3>미리보기</h3>
    <ul class="import-stats">
      <li><b>${fresh.length}</b>새 내역</li>
      <li><b>${merges.length}</b>직접 넣은 것과 합침</li>
      <li><b>${dup}</b>이미 있음 (건너뜀)</li>
      <li><b>${cancels.length}</b>결제 취소 짝</li>
      <li><b>${transfers.length}</b>내 계좌 이체</li>
    </ul>
    ${show.length ? `<div class="table-scroll"><table class="import-table"><thead><tr><th>날짜</th><th>어디서</th><th>거래구분</th><th>분류</th><th class="r">금액</th></tr></thead><tbody>
      ${show.slice(0, 80).map((t) => `<tr><td>${kstDay(t.occurred_at).slice(5).replace("-", ".")} ${kstTime(t.occurred_at)}</td><td>${esc(t.place)}</td><td class="muted">${esc(t.tx_type)}</td>
        <td>${tag(t)}${t.kind === "expense" || t.kind === "income" ? esc(catOf(t.category_id)?.name ?? "분류 없음") : ""}</td><td class="r ${t.kind}">${signedWon(t.amount)}</td></tr>`).join("")}
    </tbody></table></div>${show.length > 80 ? `<p class="muted small">외 ${show.length - 80}건</p>` : ""}` : ""}
    <p class="muted small">분류 없는 내역은 저장한 뒤 내역 화면에서 한 번 분류해 두면, 다음부터 같은 곳은 자동으로 분류돼요.</p>
    <div class="actions"><button class="btn primary" type="button" id="i-save" ${fresh.length + merges.length ? "" : "disabled"}>${fresh.length + merges.length ? `${fresh.length + merges.length}건 저장` : "새로 저장할 내역이 없어요"}</button></div>
  </section>`;
  $("#i-save").onclick = async () => {
    $("#i-save").disabled = true; $("#i-save").textContent = "저장 중…";
    const rows = fresh.map(({ _new, id, ...t }) => t);
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await sb.from("money_transactions").insert(rows.slice(i, i + 200));
      if (error) { toast("저장하지 못했어요. 다시 시도해 주세요.", "error"); $("#i-save").disabled = false; $("#i-save").textContent = "다시 저장"; return; }
    }
    for (const { manual, t } of merges) {
      await sb.from("money_transactions").update({ occurred_at: t.occurred_at, balance_after: t.balance_after, tx_type: t.tx_type, import_key: t.import_key, source: "import", place: manual.place || t.place }).eq("id", manual.id);
    }
    // 기존 내역 중 짝이 된 것도 표시를 바꿈
    for (const t of [...cancels.flat(), ...transfers.flat()].filter((x) => !x._new)) {
      await sb.from("money_transactions").update({ kind: t.kind, category_id: t.category_id ?? null, pair_id: t.pair_id ?? null }).eq("id", t.id);
    }
    toast(`${rows.length + merges.length}건을 저장했어요`);
    const latest = items.map((t) => t.occurred_at).sort().at(-1);
    go(`#/list?m=${kstMonth(latest)}`);
  };
}

/* ---------- 라우터 ---------- */
async function route() {
  document.querySelectorAll("dialog").forEach((d) => d.remove());
  const { path, params } = parseHash();
  if (path === "/login") return state.user ? go("#/", true) : renderLogin();
  if (!state.user) return go("#/login", true);
  if (!state.profile) {
    const { data } = await sb.from("profiles").select("nickname, approved").eq("id", state.user.id).maybeSingle();
    state.profile = data ?? { nickname: "", approved: false };
  }
  if (!state.profile.approved) {
    app.innerHTML = shell("/", '<div class="paper notice"><h2>승인을 기다리고 있어요</h2><p>관리자가 가입을 승인하면 가계부를 쓸 수 있어요.</p></div>');
    bindShell(); $("#fab")?.remove(); return;
  }
  try {
    await loadBase();
    if (path === "/list") return await renderList(params);
    if (path === "/accounts") return await renderAccounts();
    if (path === "/budget") return await renderBudget(params);
    if (path === "/import") return await renderImport();
    return await renderMonth(params);
  } catch {
    app.innerHTML = shell("/", '<div class="paper notice"><h2>불러오지 못했어요</h2><p>잠시 뒤 새로고침해 주세요. 계속되면 데이터베이스 설정(money.sql)을 확인해 주세요.</p></div>');
    bindShell();
  }
}

async function start() {
  if ((!SUPABASE_URL || !SUPABASE_ANON_KEY) && !window.__MONEY_TEST_CLIENT__) {
    app.innerHTML = '<main class="auth"><div class="paper notice"><h2>연결 준비 중</h2><p>js/config.js에 Supabase 주소와 키를 넣어 주세요.</p></div></main>';
    return;
  }
  sb = window.__MONEY_TEST_CLIENT__ ?? (await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm"))
    .createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true } });
  window.__meiroSb = sb; // 페이지 아래 FEEDBACK 칸도 같은 로그인을 씀
  dispatchEvent(new Event("meiro-sb"));
  const { data } = await sb.auth.getSession();
  state.user = data.session?.user ?? null;
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
