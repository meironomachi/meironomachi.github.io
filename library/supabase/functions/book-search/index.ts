// MEIROBOOK 책 검색: 카카오 책 검색을 대신 불러 줌
// 카카오 키는 Supabase 비밀 설정(KAKAO_REST_KEY)에만 두고, 웹페이지에는 노출하지 않음.
// 승인된 사용자로 로그인한 상태에서만 검색할 수 있음.

const KAKAO_REST_KEY = Deno.env.get("KAKAO_REST_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const ALLOWED = ["https://meiro.kr", "https://www.meiro.kr"];

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED.includes(origin) ? origin : ALLOWED[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

Deno.serve(async (req) => {
  const headers = cors(req.headers.get("Origin"));
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "POST로 요청해 주세요." }, 405);
  if (!KAKAO_REST_KEY) return json({ error: "KAKAO_REST_KEY 비밀 설정이 없어요." }, 500);

  // 로그인한 사용자이고 승인됐는지 확인
  const auth = req.headers.get("Authorization") ?? "";
  const user = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey: SUPABASE_ANON_KEY } });
  if (!user.ok) return json({ error: "로그인이 필요해요." }, 401);
  const { id } = await user.json();
  const approved = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_approved`, {
    method: "POST",
    headers: { Authorization: auth, apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ _user_id: id }),
  });
  if (!approved.ok || (await approved.json()) !== true) return json({ error: "승인된 사용자만 검색할 수 있어요." }, 403);

  const { query } = await req.json().catch(() => ({ query: "" }));
  const q = String(query ?? "").trim().slice(0, 100);
  if (!q) return json({ documents: [] });

  const res = await fetch(`https://dapi.kakao.com/v3/search/book?size=12&query=${encodeURIComponent(q)}`, {
    headers: { Authorization: `KakaoAK ${KAKAO_REST_KEY}` },
  });
  if (!res.ok) return json({ error: `카카오 검색 오류 (${res.status})` }, 502);
  const data = await res.json();
  const documents = (data.documents ?? []).map((d: Record<string, unknown>) => ({
    title: d.title,
    authors: d.authors,
    publisher: d.publisher,
    isbn: d.isbn,
    thumbnail: d.thumbnail,
    datetime: d.datetime,
  }));
  return json({ documents });
});
