// meiro.kr 첫 화면 'TODAY' 요약: 돈($TDL) · 근무(MEIROPAY) · 기록(일기장·MEIRONOTE·MEIROBOOK) · 할 일(투두메이트)
// 각 사이트와 같은 Supabase 로그인을 씀. 로그인하지 않았으면 할 일 칸만 보여 줌.
import { monthSummary as moneyMonth, won } from "/money/js/money.js";
import { monthSummary as payMonth } from "/pay/js/pay.js";
import * as tm from "/todomate.js";

const SUPABASE_URL = "https://eonixnwmqpiktmcaeznf.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVvbml4bndtcXBpa3RtY2Flem5mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3MjU3OTMsImV4cCI6MjEwODMwMTc5M30.2N_5RvUGwQUrBYEwq2EvuAoYTqa8faA9bWf2ZdDmB2U";

const box = document.getElementById("today");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const kst = (d = new Date()) => { const k = new Date(d.getTime() + 9 * 3600000); return `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())}`; };
const kstDayOf = (iso) => kst(new Date(iso));
const addDays = (ymd, n) => { const t = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10) + n)); return t.toISOString().slice(0, 10); };
const dot = (s) => s.replaceAll("-", ".");

async function client() {
  if (window.__TODAY_TEST_CLIENT__) return window.__TODAY_TEST_CLIENT__;
  if (window.__meiroSb) return window.__meiroSb;
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm");
  window.__meiroSb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, flowType: "pkce" } });
  dispatchEvent(new Event("meiro-sb")); // 아래 FEEDBACK 칸도 같은 연결을 씀
  return window.__meiroSb;
}

// 1,000줄씩 끝까지 읽음
async function all(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().order("id").range(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

const card = (emoji, title, href, body) => `<article class="tcard"><h3><a href="${href}">${emoji} ${title}<span aria-hidden="true">→</span></a></h3>${body}</article>`;
const row = (label, value, cls = "") => `<p class="trow ${cls}"><span>${label}</span><b>${value}</b></p>`;
const failed = (emoji, title, href) => card(emoji, title, href, '<p class="tmuted">불러오지 못했어요</p>');

/* ---------- 돈 ---------- */
async function moneyCard(sb, today) {
  const month = today.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const from = new Date(Date.UTC(y, m - 1, 1) - 9 * 3600000).toISOString(), to = new Date(Date.UTC(y, m, 1) - 9 * 3600000 + 2 * 86400000).toISOString();
  const [txs, budgets] = await Promise.all([
    all(() => sb.from("money_transactions").select("amount, kind, occurred_at, planned, place, category_id").gte("occurred_at", from).lt("occurred_at", to)),
    sb.from("money_budgets").select("amount, category_id").then((r) => r.data ?? []),
  ]);
  const inMonth = txs.filter((t) => kstDayOf(t.occurred_at).startsWith(month));
  const s = moneyMonth(inMonth);
  const budget = budgets.find((b) => !b.category_id)?.amount ?? null;
  const daysLeft = last - Number(today.slice(8)) + 1;
  const todaySpent = txs.filter((t) => !t.planned && t.kind === "expense" && kstDayOf(t.occurred_at) === today).reduce((a, t) => a - t.amount, 0);
  const soon = txs.filter((t) => t.planned && [today, addDays(today, 1)].includes(kstDayOf(t.occurred_at)));
  const left = budget !== null ? budget - s.expense : null;
  return card("💵", "돈", "/money/", `
    ${row("오늘 쓴 돈", won(todaySpent))}
    ${row("이번 달 지출", budget !== null ? `${won(s.expense)} <small>/ ${won(budget)}</small>` : won(s.expense))}
    ${left !== null ? row(left >= 0 ? `남은 ${daysLeft}일 하루에` : "예산 넘음", left >= 0 ? won(Math.floor(left / daysLeft)) : won(-left), left >= 0 ? "" : "neg") : ""}
    ${row("이번 달 수입", won(s.income))}
    ${soon.length ? `<ul class="tlist">${soon.map((t) => `<li><span class="tag">${kstDayOf(t.occurred_at) === today ? "오늘" : "내일"} 예정</span>${esc(t.place || (t.kind === "income" ? "수입" : "지출"))}<b>${t.amount > 0 ? "+" : "−"}${won(Math.abs(t.amount))}</b></li>`).join("")}</ul>` : ""}`);
}

/* ---------- 근무 ---------- */
async function payCard(sb, today) {
  const month = today.slice(0, 7);
  const start = addDays(`${month}-01`, -7), end = addDays(`${month}-01`, 40);
  const [places, shifts, manual] = await Promise.all([
    sb.from("pay_places").select("*").then((r) => r.data ?? []),
    all(() => sb.from("pay_shifts").select("*").gte("work_date", start).lt("work_date", end)),
    sb.from("pay_months").select("*").then((r) => r.data ?? []),
  ]);
  const placeOf = (id) => places.find((p) => p.id === id);
  const todays = shifts.filter((s) => s.work_date === today);
  const next = shifts.filter((s) => s.work_date > today).sort((a, b) => a.work_date.localeCompare(b.work_date) || a.start_time.localeCompare(b.start_time))[0];
  const sum = payMonth(shifts, places, month, manual);
  const time = (s) => (placeOf(s.place_id)?.pay_kind === "daily" ? "일당" : `${s.start_time}~${s.end_time}`);
  return card("💰", "근무", "/pay/", `
    ${todays.length ? `<ul class="tlist">${todays.map((s) => `<li><i class="sw" style="background:${esc(placeOf(s.place_id)?.color ?? "var(--g500)")}"></i>${esc(placeOf(s.place_id)?.name ?? "근무")}<b>${time(s)}</b></li>`).join("")}</ul>` : `<p class="tmuted">오늘은 근무가 없어요${next ? ` · 다음 ${dot(next.work_date).slice(5)} ${esc(placeOf(next.place_id)?.name ?? "")}` : ""}</p>`}
    ${row("이번 달 예상 월급", `${won(sum.net)} <small>세후</small>`)}
    ${row("이번 달 일한 시간", `${Math.floor(sum.minutes / 60)}시간${sum.minutes % 60 ? ` ${sum.minutes % 60}분` : ""}`)}`);
}

/* ---------- 기록 ---------- */
async function recordCard(sb, today) {
  const month = today.slice(0, 7);
  const [diary, posts, books] = await Promise.all([
    sb.from("entries").select("id").eq("entry_date", today).limit(1).then((r) => r.data ?? []),
    sb.from("writing_posts").select("id, status, written_on").gte("written_on", `${month}-01`).lte("written_on", `${month}-31`).then((r) => r.data ?? []),
    sb.from("books").select("title, progress, total_pages, progress_unit").eq("status", "reading").then((r) => r.data ?? []),
  ]);
  const published = posts.filter((p) => p.status !== "draft").length;
  return card("📝", "기록", "/saytqtul/", `
    ${row("오늘 일기", diary.length ? "썼어요 ✓" : '<a href="/saytqtul/">아직이에요 →</a>', diary.length ? "ok" : "")}
    ${row("이번 달 올린 글", `${published}편${posts.length - published ? ` <small>· 임시 ${posts.length - published}</small>` : ""}`)}
    ${books.length ? `<ul class="tlist">${books.slice(0, 3).map((b) => `<li><span class="tag">읽는 중</span>${esc(b.title)}${b.total_pages && b.progress_unit !== "percent" ? `<b>${b.progress ?? 0}/${b.total_pages}쪽</b>` : b.progress ? `<b>${b.progress}%</b>` : ""}</li>`).join("")}</ul>` : ""}`);
}

/* ---------- 할 일 (투두메이트) ---------- */
function todoCard() {
  return `<article class="tcard todo" id="todo-card"><h3><span>✅ 할 일 <small>투두메이트</small></span></h3><div id="todo-body"><p class="tmuted">불러오는 중…</p></div></article>`;
}
async function drawTodos(today) {
  const body = document.getElementById("todo-body");
  if (!body) return;
  if (!tm.isConnected()) {
    body.innerHTML = `<p class="tmuted">투두메이트에 적은 오늘 할 일을 여기서 볼 수 있어요.</p>
      <details class="tm-connect"><summary>투두메이트 연결하기</summary>
        <form id="tm-form">
          <input name="email" type="email" autocomplete="username" placeholder="투두메이트 이메일" required>
          <input name="password" type="password" autocomplete="current-password" placeholder="비밀번호" required>
          <button type="submit">연결</button>
          <p class="tnote">비밀번호는 이 브라우저에서 Google(투두메이트 로그인 서버)로만 보내고 저장하지 않아요. 이 기기에만 로그인이 유지돼요. 투두메이트의 공식 기능이 아니라서 앱이 바뀌면 안 될 수 있어요.</p>
          <p class="terr" id="tm-err" role="alert"></p>
        </form></details>`;
    document.getElementById("tm-form").onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      f.querySelector("button").disabled = true;
      try { await tm.connect(f.email.value.trim(), f.password.value); f.password.value = ""; drawTodos(today); }
      catch (err) { document.getElementById("tm-err").textContent = err.message; f.querySelector("button").disabled = false; }
    };
    return;
  }
  try {
    const list = await tm.todosOn(today);
    const done = list.filter((t) => t.done).length;
    body.innerHTML = `${list.length ? `<p class="trow"><span>오늘</span><b>${done}/${list.length} 완료</b></p>
      <ul class="tlist todos">${list.map((t) => `<li class="${t.done ? "done" : ""}"><span class="ck" aria-label="${t.done ? "완료" : "안 함"}">${t.done ? "✓" : ""}</span>${t.goal ? `<span class="goal" style="--c:${esc(t.goal.color ?? "var(--g500)")}">${esc(t.goal.name)}</span>` : ""}<span class="txt">${esc(t.content)}</span></li>`).join("")}</ul>`
      : '<p class="tmuted">오늘 적은 할 일이 없어요</p>'}
      <p class="tfoot"><button type="button" class="linkbtn" id="tm-reload">새로고침</button> · <button type="button" class="linkbtn" id="tm-off">연결 끊기</button></p>`;
  } catch (err) {
    body.innerHTML = `<p class="terr">${esc(err.message)}</p><p class="tfoot"><button type="button" class="linkbtn" id="tm-reload">다시 시도</button> · <button type="button" class="linkbtn" id="tm-off">연결 끊기</button></p>`;
  }
  document.getElementById("tm-reload").onclick = () => drawTodos(today);
  document.getElementById("tm-off").onclick = () => { tm.disconnect(); drawTodos(today); };
}

/* ---------- 그리기 ---------- */
async function draw() {
  if (!box) return;
  const today = kst();
  let sb = null, session = null;
  try { sb = await client(); session = (await sb.auth.getSession()).data.session; } catch { /* 연결 실패 → 할 일만 */ }
  box.querySelector(".tgrid").innerHTML = session
    ? '<p class="tmuted">불러오는 중…</p>'
    : `${todoCard()}<article class="tcard"><h3><span>🔒 로그인</span></h3><p class="tmuted">로그인하면 오늘 쓴 돈, 근무, 일기를 여기서 한눈에 볼 수 있어요.</p><p><a href="/money/#/login">로그인하러 가기 →</a></p></article>`;
  if (session) {
    const parts = await Promise.all([
      moneyCard(sb, today).catch(() => failed("💵", "돈", "/money/")),
      payCard(sb, today).catch(() => failed("💰", "근무", "/pay/")),
      recordCard(sb, today).catch(() => failed("📝", "기록", "/saytqtul/")),
    ]);
    box.querySelector(".tgrid").innerHTML = parts.join("") + todoCard();
  }
  drawTodos(today);
}

draw();
// 자정이 지나면 날짜가 바뀌므로 다시 그림
let day = kst();
setInterval(() => { if (kst() !== day) { day = kst(); draw(); } }, 60000);
