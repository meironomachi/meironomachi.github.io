// 회원 관리: 관리자가 다른 사람의 닉네임·이메일·비밀번호·승인·관리자 권한을 바꿈
// 이메일과 비밀번호는 Supabase 인증 서버의 관리자 기능으로만 바꿀 수 있어서 이 함수에서 처리함.
// service_role 키는 Supabase가 함수 안에만 넣어 주는 값이라 웹페이지에는 드러나지 않음.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED = ["https://meiro.kr", "https://www.meiro.kr"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED.includes(origin) ? origin : ALLOWED[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const service = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };
const rest = (path: string, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...service, ...(init.headers ?? {}) } });

Deno.serve(async (req) => {
  const headers = cors(req.headers.get("Origin"));
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "POST로 요청해 주세요." }, 405);
  if (!SERVICE_KEY) return json({ error: "서버 설정이 빠져 있어요." }, 500);

  // 부른 사람이 로그인한 관리자인지 확인
  const me = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: req.headers.get("Authorization") ?? "", apikey: SUPABASE_ANON_KEY } });
  if (!me.ok) return json({ error: "다시 로그인해 주세요." }, 401);
  const caller = await me.json();
  const roles = await (await rest(`user_roles?select=id&user_id=eq.${caller.id}&role=eq.admin`)).json();
  if (!Array.isArray(roles) || !roles.length) return json({ error: "관리자만 할 수 있어요." }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "요청을 읽지 못했어요." }, 400); }
  const id = String(body.user_id ?? "");
  if (!UUID.test(id)) return json({ error: "회원을 찾지 못했어요." }, 400);
  const self = id === caller.id;

  const nickname = typeof body.nickname === "string" ? body.nickname.trim() : undefined;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : undefined;
  const password = typeof body.password === "string" && body.password ? body.password : undefined;
  const approved = typeof body.approved === "boolean" ? body.approved : undefined;
  const isAdmin = typeof body.is_admin === "boolean" ? body.is_admin : undefined;
  if (nickname !== undefined && !nickname) return json({ error: "닉네임을 적어 주세요." }, 400);
  if (email !== undefined && !EMAIL.test(email)) return json({ error: "이메일 모양이 아니에요." }, 400);
  if (password !== undefined && password.length < 6) return json({ error: "비밀번호는 6자 이상이어야 해요." }, 400);
  // 스스로 잠기지 않게: 내 승인과 관리자 권한은 여기서 끄지 못함
  if (self && (approved === false || isAdmin === false)) return json({ error: "내 승인이나 관리자 권한은 끌 수 없어요." }, 400);

  // 이메일·비밀번호: 인증 서버에서 바로 바꿈 (확인 메일 없이)
  if (email !== undefined || password !== undefined) {
    const attrs: Record<string, unknown> = {};
    if (email !== undefined) { attrs.email = email; attrs.email_confirm = true; }
    if (password !== undefined) attrs.password = password;
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { method: "PUT", headers: service, body: JSON.stringify(attrs) });
    if (!r.ok) {
      const msg = JSON.stringify(await r.json().catch(() => ({})));
      if (/already|exists|registered/i.test(msg)) return json({ error: "이미 다른 계정이 쓰는 이메일이에요." }, 409);
      if (/not.?found/i.test(msg)) return json({ error: "회원을 찾지 못했어요." }, 404);
      if (/password/i.test(msg)) return json({ error: "쓸 수 없는 비밀번호예요. 더 길거나 복잡하게 정해 주세요." }, 400);
      return json({ error: "인증 정보를 바꾸지 못했어요." }, 400);
    }
  }

  // 프로필: 닉네임, 이메일(목록·아이디 찾기에 쓰는 사본), 승인
  const patch: Record<string, unknown> = {};
  if (nickname !== undefined) patch.nickname = nickname;
  if (email !== undefined) patch.email = email;
  if (approved !== undefined) patch.approved = approved;
  if (Object.keys(patch).length) {
    const r = await rest(`profiles?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    if (!r.ok) return json({ error: "프로필을 바꾸지 못했어요." }, 400);
  }

  // 관리자 권한
  if (isAdmin === true) {
    const r = await rest("user_roles?on_conflict=user_id,role", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates" }, body: JSON.stringify({ user_id: id, role: "admin" }) });
    if (!r.ok) return json({ error: "관리자 권한을 주지 못했어요." }, 400);
  } else if (isAdmin === false) {
    const r = await rest(`user_roles?user_id=eq.${id}&role=eq.admin`, { method: "DELETE" });
    if (!r.ok) return json({ error: "관리자 권한을 빼지 못했어요." }, 400);
  }

  return json({ ok: true });
});
