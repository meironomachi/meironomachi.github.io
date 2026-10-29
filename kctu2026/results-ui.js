// 개표 결과 화면: 누구나 보고, 관리자로 로그인했으면 직접 입력. 1분마다 새로 불러옴
import { judgeFirst, judgeRunoff, headline, fromPercents } from "./results.js?v=4";

const SUPABASE_URL = "https://eonixnwmqpiktmcaeznf.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVvbml4bndtcXBpa3RtY2Flem5mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3MjU3OTMsImV4cCI6MjEwODMwMTc5M30.2N_5RvUGwQUrBYEwq2EvuAoYTqa8faA9bWf2ZdDmB2U";
const ROW_ID = "2026";
const IDS = [1, 2, 3, 4];
const ELIGIBLE = 977175; // 선거인수 (입력 창에서 다른 값을 적으면 그 값을 씀)

const box = document.getElementById("results");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const n0 = (v) => Number(v || 0).toLocaleString("ko-KR");
const pct = (v) => `${(Math.round(v * 10) / 10).toFixed(1)}%`;
const slate = (n) => window.KCTU?.SLATES?.find((s) => s.n === n);
const stamp = (iso) => {
  if (!iso) return "";
  const t = new Date(new Date(iso).getTime() + 9 * 3600 * 1000), p = (x) => String(x).padStart(2, "0");
  return `${t.getUTCMonth() + 1}월 ${t.getUTCDate()}일 ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
};

let sb = null, data = {}, updatedAt = null, isAdmin = false, loadError = false;

async function client() {
  if (window.__meiroSb) return (sb = window.__meiroSb);
  sb = window.__KCTU_TEST_CLIENT__ ?? (await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm"))
    .createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, flowType: "pkce" } });
  window.__meiroSb = sb; // 페이지 아래 FEEDBACK 칸도 같은 연결을 씀
  dispatchEvent(new Event("meiro-sb"));
  return sb;
}

async function load() {
  const { data: row, error } = await sb.from("kctu_election").select("data, updated_at").eq("id", ROW_ID).maybeSingle();
  loadError = !!error;
  if (!error && row) { data = row.data ?? {}; updatedAt = row.updated_at; }
}

async function checkAdmin(session) {
  const uid = session?.user?.id;
  if (!uid) { isAdmin = false; return; }
  const { data: r } = await sb.from("user_roles").select("role").eq("user_id", uid).eq("role", "admin");
  isAdmin = (r ?? []).length > 0;
}

/* ---------- 그리기 ---------- */
function bars(result, { badge }) {
  // 막대와 숫자는 과반 기준(기본: 총 투표수) 대비 비율이라 과반선은 늘 가운데
  return `<ol class="res-bars">${result.rows.map((r, i) => {
    const s = slate(r.n);
    const tag = badge(r.n, i);
    return `<li data-n="${r.n}" class="${tag ? "picked" : ""}">
      <span class="rn">${r.n}</span>
      <span class="rw"><b>${esc(s?.people[0][0] ?? "")}</b><small>${esc(s?.slogan ?? "")}</small></span>
      <span class="rbar" aria-hidden="true"><i style="width:${Math.min(100, r.basePct)}%"></i><em title="과반선"></em></span>
      <span class="rv" title="유효투표 대비 ${pct(r.pct)}"><b>${pct(r.basePct)}</b><small>${n0(r.votes)}표</small></span>
      <span class="rtag">${tag ? `<span class="tag ${tag.cls}">${tag.text}</span>` : ""}</span>
    </li>`;
  }).join("")}</ol>`;
}

function stats(round, valid) {
  round = { ...round, eligible: round.eligible || ELIGIBLE };
  const items = [
    round.eligible ? ["선거인", `${n0(round.eligible)}명`] : null,
    round.turnout ? ["투표", `${n0(round.turnout)}명${round.eligible ? ` · 투표율 ${pct(round.turnout / round.eligible * 100)}` : ""}`] : null,
    ["유효표", `${n0(valid)}표`],
    round.invalid ? ["무효표", `${n0(round.invalid)}표`] : null,
    round.counted ? ["개표율", pct(round.counted)] : null,
  ].filter(Boolean);
  return `<dl class="res-stats">${items.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
}

function draw() {
  const first = judgeFirst(data, IDS);
  const pair = first.final && first.runoff && !first.tie ? first.runoff : null;
  const runoff = pair ? judgeRunoff(data, pair) : null;
  const head = headline(first, runoff);
  const basisText = data.basis === "valid" ? "유효투표" : "총 투표수(무효표 포함)";
  box.dataset.state = head.kind;
  box.dataset.mock = data.mock && first.started ? "1" : "";
  box.innerHTML = `<div class="wrap">
    ${data.mock && first.started ? '<p class="mock-band" role="note">모의 개표 · 실제 결과가 아니에요</p>' : ""}
    <div class="res-head">
      <div><p class="res-kicker">개표 결과${data.mock && first.started ? " (모의)" : ""}</p>
        <h2 class="res-title" ${head.n ? `data-n="${head.n}"` : ""}>${esc(head.text)}</h2></div>
      ${isAdmin ? '<button class="tool res-edit" type="button" id="res-edit">결과 입력</button>' : ""}
    </div>
    ${loadError ? '<p class="res-note">개표 결과를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.</p>' : ""}
    ${first.started ? `
      ${runoff ? `<section class="res-round"><h3>결선 투표 ${runoff.final ? "<span>확정</span>" : runoff.started ? "<span class=live>개표 중</span>" : "<span>개표 전</span>"}</h3>
        ${runoff.started ? stats(data.runoff ?? {}, runoff.valid) + bars(runoff, { badge: (n) => (runoff.final && runoff.winner === n ? { cls: "won", text: "당선" } : null) })
          : `<p class="res-note">기호 ${pair[0]}번과 ${pair[1]}번 후보조의 결선 투표 결과를 기다리고 있어요.</p>`}
      </section>` : ""}
      <section class="res-round"><h3>1차 투표 ${first.final ? "<span>확정</span>" : "<span class=live>개표 중</span>"}</h3>
        ${stats(data.first ?? {}, first.valid)}
        ${bars(first, { badge: (n) => first.final ? (first.winner === n ? { cls: "won", text: "당선" } : first.runoff?.includes(n) && !first.tie ? { cls: "run", text: "결선 진출" } : null) : null })}
      </section>
      <p class="res-note">득표율과 막대는 ${basisText} 대비예요. 과반 기준: 그 절반 초과 (막대 가운데 점선). 단독 과반 후보조가 없으면 1·2위 후보조가 결선에 올라가요. ${data.mock ? "지금 보이는 숫자는 화면을 미리 보기 위한 <b>모의 결과</b>예요." : "결과는 공식 발표를 옮겨 적은 것으로, 정확한 결과는 선거관리위원회 공고를 확인해 주세요."}${updatedAt && first.started ? ` · ${stamp(updatedAt)} 기준` : ""}</p>`
      : `<dl class="res-stats" style="margin-top:12px"><div><dt>선거인</dt><dd>${n0(ELIGIBLE)}명</dd></div></dl><p class="res-note">개표가 시작되면 후보조별 득표와 당선·결선 여부를 여기에 보여 드려요. 단독 과반 후보조가 없으면 1·2위 후보조가 결선에 올라가요.</p>`}
  </div>`;
  document.getElementById("res-edit")?.addEventListener("click", editDialog);
}

/* ---------- 관리자 입력: 득표수로, 또는 (모의 단계에서) 퍼센트로 ---------- */
function editDialog() {
  const first = judgeFirst(data, IDS);
  const pair = first.final && first.runoff && !first.tie ? first.runoff : null;
  const f = data.first ?? {}, r = data.runoff ?? {};
  const mode = data.inputMode === "pct" ? "pct" : "votes";
  const field = (name, label, value, extra = "") => `<label class="rf"><span>${label}</span><input name="${name}" inputmode="numeric" value="${value ?? ""}" ${extra}></label>`;
  const pfield = (name, label, value) => field(name, label, value, 'inputmode="decimal" placeholder="%"');
  const who = (n) => `기호 ${n}번 ${esc(slate(n)?.people[0][0] ?? "")}`;
  const dlg = document.createElement("dialog");
  dlg.className = "res-dlg";
  dlg.innerHTML = `<form method="dialog" data-mode="${mode}">
    <h2>개표 결과 입력</h2>
    <fieldset class="rb rb-row"><legend>입력 방식</legend>
      <label><input type="radio" name="mode" value="votes" ${mode === "votes" ? "checked" : ""}> 득표수</label>
      <label><input type="radio" name="mode" value="pct" ${mode === "pct" ? "checked" : ""}> 득표율(%) — 표 수는 자동 계산</label>
    </fieldset>
    <fieldset class="rb"><legend>과반 기준</legend>
      <label><input type="radio" name="basis" value="turnout" ${data.basis !== "valid" ? "checked" : ""}> 총 투표수(무효표 포함)의 절반 초과 (기본)</label>
      <label><input type="radio" name="basis" value="valid" ${data.basis === "valid" ? "checked" : ""}> 유효투표의 절반 초과</label>
    </fieldset>
    <div class="rgrid">${field("fe", "선거인수", f.eligible ?? ELIGIBLE)}</div>
    <h3>1차 투표</h3>
    <div class="m-votes">
      <div class="rgrid">${IDS.map((n) => field(`f${n}`, who(n), f.votes?.[n])).join("")}</div>
      <div class="rgrid">${field("ft", "총 투표수 (비우면 유효+무효)", f.turnout)}${field("fi", "무효표 (선택)", f.invalid)}</div>
    </div>
    <div class="m-pct">
      <div class="rgrid">${pfield("ftp", "투표율 % (선거인 대비)", f.turnoutPct)}</div>
      <div class="rgrid">${IDS.map((n) => pfield(`fp${n}`, `${who(n)} %`, f.pcts?.[n])).join("")}</div>
      <p class="res-help pv" id="pv-first"></p>
    </div>
    <div class="rgrid">${field("fc", "개표율 % (선택)", f.counted, 'inputmode="decimal"')}</div>
    <label class="rcheck"><input type="checkbox" name="ff" ${f.final ? "checked" : ""}> 1차 개표 확정 (확정해야 당선·결선이 정해져요)</label>
    ${pair ? `<h3>결선 투표 · 기호 ${pair[0]}번 vs ${pair[1]}번</h3>
      <div class="m-votes">
        <div class="rgrid">${pair.map((n) => field(`r${n}`, who(n), r.votes?.[n])).join("")}</div>
        <div class="rgrid">${field("rt", "총 투표수 (비우면 유효+무효)", r.turnout)}${field("ri", "무효표 (선택)", r.invalid)}</div>
      </div>
      <div class="m-pct">
        <div class="rgrid">${pfield("rtp", "투표율 % (선거인 대비)", r.turnoutPct)}${pair.map((n) => pfield(`rp${n}`, `${who(n)} %`, r.pcts?.[n])).join("")}</div>
        <p class="res-help pv" id="pv-runoff"></p>
      </div>
      <div class="rgrid">${field("rc", "개표율 % (선택)", r.counted, 'inputmode="decimal"')}</div>
      <label class="rcheck"><input type="checkbox" name="rf" ${r.final ? "checked" : ""}> 결선 개표 확정</label>`
      : '<p class="res-help">1차를 확정했는데 단독 과반이 없으면, 저장 뒤 다시 열었을 때 결선 칸이 생겨요.</p>'}
    <label class="rcheck mock-check"><input type="checkbox" name="mock" ${data.mock ?? mode === "pct" ? "checked" : ""}> 모의 결과로 표시 (페이지에 "모의 개표 · 실제 결과가 아니에요" 띠가 붙어요)</label>
    <p class="res-msg" id="res-msg" role="status"></p>
    <div class="ractions">${data.first || data.runoff ? '<button class="tool danger" type="button" value="wipe">결과 삭제</button>' : ""}<button class="tool" type="button" value="cancel">취소</button><button class="tool primary" type="submit">저장</button></div>
  </form>`;
  document.body.append(dlg);
  const fm = dlg.querySelector("form");
  const int = (name) => { const v = String(fm[name]?.value ?? "").replace(/[^\d]/g, ""); return v === "" ? null : Number(v); };
  const dec = (name) => { const v = parseFloat(String(fm[name]?.value ?? "").replace(/[^\d.]/g, "")); return Number.isFinite(v) ? Math.min(100, v) : null; };
  const msg = (t) => { dlg.querySelector("#res-msg").textContent = t; };
  // 퍼센트 → 표 수 (미리보기와 저장에 같이 씀)
  const convert = (prefix, ids) => fromPercents({ eligible: int("fe") ?? ELIGIBLE, turnoutPct: dec(`${prefix}tp`), pcts: Object.fromEntries(ids.map((n) => [n, dec(`${prefix}p${n}`)])) }, ids);
  const preview = () => {
    const show = (id, prefix, ids) => {
      const el = dlg.querySelector(id); if (!el) return;
      const c = convert(prefix, ids);
      el.innerHTML = c.error ? esc(c.error) : `투표 ${n0(c.turnout)}명 → ${ids.map((n) => `${n}번 ${n0(c.votes[n])}표`).join(" · ")} · 무효 ${n0(c.invalid)}표 (${pct(c.invalidPct)})`;
      el.classList.toggle("bad", !!c.error);
    };
    show("#pv-first", "f", IDS);
    if (pair) show("#pv-runoff", "r", pair);
  };
  fm.addEventListener("input", preview);
  fm.querySelectorAll("[name=mode]").forEach((x) => x.onchange = () => { fm.dataset.mode = x.value; if (x.value === "pct") fm.mock.checked = true; preview(); });
  preview();
  fm.querySelector("[value=cancel]").onclick = () => dlg.close();
  // 1차·결선 결과를 모두 지워 개표 전 상태로 (행은 남기고 내용만 비움)
  const wipe = fm.querySelector("[value=wipe]");
  if (wipe) wipe.onclick = async () => {
    if (!confirm("입력한 개표 결과(1차·결선)를 모두 지울까요? 되돌릴 수 없어요.")) return;
    wipe.disabled = true;
    const now = new Date().toISOString();
    const { error } = await sb.from("kctu_election").update({ data: {}, updated_at: now }).eq("id", ROW_ID);
    if (error) { wipe.disabled = false; msg("삭제하지 못했어요. 관리자 계정으로 로그인했는지 확인해 주세요."); return; }
    data = {}; updatedAt = now;
    dlg.close();
    draw();
  };
  dlg.addEventListener("close", () => dlg.remove());
  fm.onsubmit = async (e) => {
    e.preventDefault();
    const m = fm.mode.value, eligible = int("fe") ?? ELIGIBLE;
    let firstNext, runoffNext = data.runoff ?? null;
    if (m === "pct") {
      const c = convert("f", IDS);
      if (c.error) { msg(`1차: ${c.error}`); return; }
      firstNext = { votes: c.votes, turnout: c.turnout, invalid: c.invalid, turnoutPct: dec("ftp"), pcts: Object.fromEntries(IDS.map((n) => [n, dec(`fp${n}`)])) };
      if (pair) {
        const rc = convert("r", pair);
        if (rc.error) { msg(`결선: ${rc.error}`); return; }
        runoffNext = { votes: rc.votes, turnout: rc.turnout, invalid: rc.invalid, turnoutPct: dec("rtp"), pcts: Object.fromEntries(pair.map((n) => [n, dec(`rp${n}`)])) };
      }
    } else {
      firstNext = { votes: Object.fromEntries(IDS.map((n) => [n, int(`f${n}`) ?? 0])), turnout: int("ft"), invalid: int("fi") };
      if (pair) runoffNext = { votes: Object.fromEntries(pair.map((n) => [n, int(`r${n}`) ?? 0])), turnout: int("rt"), invalid: int("ri") };
    }
    const next = {
      basis: fm.basis.value, inputMode: m, mock: fm.mock.checked,
      first: { ...firstNext, eligible, counted: dec("fc"), final: fm.ff.checked },
      runoff: pair ? { ...runoffNext, counted: dec("rc"), final: fm.rf.checked } : runoffNext,
    };
    fm.querySelector("[type=submit]").disabled = true;
    const now = new Date().toISOString();
    const { error } = await sb.from("kctu_election").update({ data: next, updated_at: now }).eq("id", ROW_ID);
    if (error) { fm.querySelector("[type=submit]").disabled = false; msg("저장하지 못했어요. 관리자 계정으로 로그인했는지 확인해 주세요."); return; }
    data = next; updatedAt = now;
    dlg.close();
    draw();
  };
  dlg.showModal();
}

/* ---------- 시작 ---------- */
(async () => {
  try {
    await client();
    const { data: s } = await sb.auth.getSession();
    await Promise.all([load(), checkAdmin(s.session)]);
  } catch { loadError = true; }
  draw();
  sb?.auth.onAuthStateChange((event, session) => {
    if (!["SIGNED_IN", "SIGNED_OUT"].includes(event)) return;
    setTimeout(async () => { await checkAdmin(session); draw(); }, 0);
  });
  // 개표 중에는 1분마다 새로 불러옴 (입력 창이 열려 있으면 건너뜀)
  setInterval(async () => {
    if (document.hidden || document.querySelector(".res-dlg")) return;
    await load(); draw();
  }, 60000);
})();
