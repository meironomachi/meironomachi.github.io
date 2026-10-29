// meiro.kr 공통 FEEDBACK: 페이지 맨 아래에 붙는 의견 보내기 칸
// 로그인했으면 설정된 닉네임으로(서버가 정함), 아니면 닉네임을 적어서 보냄. 관리자는 회원 관리 → 피드백에서 읽음.
// 사이트가 만든 Supabase 연결(window.__meiroSb)이 있으면 그걸 쓰고, 없으면(메인 페이지) 직접 연결함.
const SUPABASE_URL = "https://eonixnwmqpiktmcaeznf.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVvbml4bndtcXBpa3RtY2Flem5mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3MjU3OTMsImV4cCI6MjEwODMwMTc5M30.2N_5RvUGwQUrBYEwq2EvuAoYTqa8faA9bWf2ZdDmB2U";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const css = `
.meiro-fb{max-width:960px;margin:56px auto 0;padding:32px max(16px,env(safe-area-inset-right)) calc(40px + env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left));
  border-top:1px solid var(--border,var(--line,#e3e5ec));color:var(--fg,var(--ink,#1d2230));font-family:inherit}
.meiro-fb h2{margin:0;font-size:15px;font-weight:800;letter-spacing:.24em;color:var(--primary,var(--g700,#0031b0))}
.meiro-fb .fb-desc{margin:6px 0 16px;font-size:14px;color:var(--muted-fg,var(--muted,#6b7180))}
.meiro-fb form{display:grid;gap:10px}
.meiro-fb .fb-who{font-size:13px;color:var(--muted-fg,var(--muted,#6b7180));margin:0}
.meiro-fb .fb-who b{color:var(--fg,var(--ink,#1d2230))}
.meiro-fb input,.meiro-fb textarea{width:100%;box-sizing:border-box;font:inherit;font-size:15px;color:var(--fg,var(--ink,#1d2230));background:var(--card,#fff);
  border:1px solid var(--border,var(--line,#e3e5ec));border-radius:8px;padding:9px 12px}
.meiro-fb input{max-width:280px}
.meiro-fb textarea{min-height:96px;resize:vertical;line-height:1.6}
.meiro-fb input:focus,.meiro-fb textarea:focus{outline:2px solid var(--primary,var(--g700,#0031b0));outline-offset:-1px}
.meiro-fb .fb-row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.meiro-fb .fb-count{font-size:12px;color:var(--muted-fg,var(--muted,#6b7180));font-variant-numeric:tabular-nums}
.meiro-fb button{font:inherit;font-size:14px;font-weight:700;border:0;border-radius:8px;padding:9px 22px;cursor:pointer;
  background:var(--primary,var(--g700,#0031b0));color:var(--primary-fg,var(--on-accent,#fff))}
.meiro-fb button:disabled{opacity:.45;cursor:default}
.meiro-fb .fb-done{margin:0;font-size:14px;color:var(--primary,var(--g700,#0031b0));font-weight:600}
.meiro-fb .fb-err{margin:0;font-size:14px;color:var(--danger,#d4342c)}
`;

async function client() {
  if (window.__meiroSb) return window.__meiroSb;
  // 사이트 앱이 있는 페이지(또는 data-meiro-sb-wait 표시가 있는 페이지)는 그 연결을 잠깐 기다림 (같은 로그인을 두 번 관리하지 않게)
  if (document.getElementById("app") || document.querySelector("[data-meiro-sb-wait]")) {
    const got = await new Promise((res) => {
      const t = setTimeout(() => res(null), 6000);
      addEventListener("meiro-sb", () => { clearTimeout(t); res(window.__meiroSb); }, { once: true });
    });
    if (got) return got;
  }
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm");
  window.__meiroSb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, flowType: "pkce" } });
  return window.__meiroSb;
}

async function mount() {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  const box = document.createElement("footer");
  box.className = "meiro-fb";
  box.setAttribute("aria-labelledby", "meiro-fb-title");
  box.innerHTML = `<h2 id="meiro-fb-title">FEEDBACK</h2><p class="fb-desc">이 웹사이트에 필요한 점이 있다면 알려 주세요.</p><div class="fb-body"><p class="fb-who">불러오는 중…</p></div>`;
  // 알림(토스트) 칸보다 앞, 본문 맨 끝에
  const toasts = document.getElementById("toasts");
  if (toasts) toasts.before(box); else document.body.append(box);

  let sb;
  try { sb = await client(); } catch { box.querySelector(".fb-body").innerHTML = '<p class="fb-err">지금은 보낼 수 없어요. 잠시 뒤 새로고침해 주세요.</p>'; return; }
  let me = null; // 로그인한 회원의 닉네임
  let draft = "", guestName = "";

  const draw = (msg = "") => {
    const body = box.querySelector(".fb-body");
    body.innerHTML = `<form novalidate>
      ${me ? `<p class="fb-who"><b>${esc(me)}</b> 님으로 보내요</p>` : `<input name="nick" maxlength="40" placeholder="닉네임" aria-label="닉네임" autocomplete="nickname" value="${esc(guestName)}">`}
      <textarea name="content" maxlength="2000" placeholder="필요한 기능, 불편한 점, 고쳐야 할 곳 …" aria-label="피드백 내용">${esc(draft)}</textarea>
      <div class="fb-row"><span class="fb-count">${draft.length}/2000</span><button type="submit">전송</button></div>
      ${msg}
    </form>`;
    const f = body.querySelector("form");
    const sync = () => {
      draft = f.content.value; guestName = f.nick?.value ?? guestName;
      f.querySelector(".fb-count").textContent = `${draft.length}/2000`;
      f.querySelector("button").disabled = !draft.trim() || (!me && !guestName.trim());
    };
    f.addEventListener("input", sync);
    sync();
    f.onsubmit = async (e) => {
      e.preventDefault();
      sync();
      if (f.querySelector("button").disabled) return;
      f.querySelector("button").disabled = true;
      const { error } = await sb.from("feedback").insert({ nickname: me ?? guestName.trim(), content: draft.trim(), page: location.pathname.slice(0, 200) });
      if (error) { draw('<p class="fb-err">보내지 못했어요. 잠시 뒤 다시 해 주세요.</p>'); return; }
      draft = "";
      draw('<p class="fb-done">보냈어요. 고마워요!</p>');
    };
  };

  const who = async (session) => {
    if (!session?.user) { me = null; return; }
    const { data } = await sb.from("profiles").select("nickname").eq("id", session.user.id).maybeSingle();
    me = data?.nickname?.trim() || session.user.email?.split("@")[0] || "회원";
  };
  const { data } = await sb.auth.getSession();
  await who(data.session);
  draw();
  // 로그인·로그아웃하면 보내는 사람 칸도 바뀜
  sb.auth.onAuthStateChange((event, session) => {
    if (!["SIGNED_IN", "SIGNED_OUT", "USER_UPDATED"].includes(event)) return;
    setTimeout(async () => { await who(session); draw(); }, 0); // 인증 처리 중에 다시 부르지 않게 한 박자 뒤
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
