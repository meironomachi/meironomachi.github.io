// 가계부 캡처 읽기: 은행 앱 거래내역 캡처(이미지)를 Claude에게 보내 거래 줄(날짜·시각·누구·금액·잔액)로 돌려받음
// 승인된 회원만 쓸 수 있음. Anthropic API 키는 Supabase 비밀값(ANTHROPIC_API_KEY)에만 있고 웹페이지에는 드러나지 않음.
// 이미지는 읽기에만 쓰고 어디에도 저장하지 않음.
import Anthropic from "npm:@anthropic-ai/sdk";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ALLOWED = ["https://meiro.kr", "https://www.meiro.kr"];
const TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGES = 8;
const MAX_B64 = 5_000_000; // 이미지 한 장 (base64 글자 수)

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED.includes(origin) ? origin : ALLOWED[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

// 돌려받을 모양: 거래 한 줄씩
const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string", description: "YYYY-MM-DD" },
          time: { type: "string", description: "HH:MM (24h), or empty if not shown" },
          amount: { type: "integer", description: "KRW. Negative = money out, positive = money in" },
          counterparty: { type: "string", description: "who/where, exactly as shown" },
          balance_after: { type: ["integer", "null"], description: "balance after this transaction if shown" },
          tx_type: { type: "string", description: "short label if shown (체크카드, 이체, ATM …), else empty" },
        },
        required: ["date", "time", "amount", "counterparty", "balance_after", "tx_type"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

const prompt = (today: string) => `These images are screenshots of a transaction history list from a Korean banking or card app, in order (top to bottom). Some may be consecutive pieces of one long screenshot, so a row near an edge can appear in two images.

Extract every transaction row you can read.
- Today is ${today} (Korea time). Dates are often shown as group headers (e.g. "10.28 (화)", "오늘", "어제") above their rows. When the year is not shown, use the latest year that does not put the date after today.
- amount: whole won. Negative for money going out (출금, 결제, 보냄, a minus sign), positive for money coming in (입금, 받음, 환불, a plus sign). Use the colour or sign the app shows.
- counterparty: the person, shop or memo text shown for the row, as written.
- time: 24-hour HH:MM if shown, otherwise "".
- balance_after: the balance shown for that row (잔액), otherwise null.
- tx_type: a short type label if the app shows one, otherwise "".
- Skip totals, monthly summaries, pending/scheduled items, ads and anything that is not a single transaction. Skip a row cut off at the image edge if its amount or date can't be read. Do not guess values that are not visible.
If nothing in the images is a transaction list, return an empty items array.`;

Deno.serve(async (req) => {
  const headers = cors(req.headers.get("Origin"));
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "POST로 요청해 주세요." }, 405);
  if (!API_KEY || !SERVICE_KEY) return json({ error: "캡처 읽기 설정(API 키)이 아직 안 돼 있어요." }, 500);

  // 부른 사람이 로그인한, 승인된 회원인지 확인
  const me = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: req.headers.get("Authorization") ?? "", apikey: SUPABASE_ANON_KEY } });
  if (!me.ok) return json({ error: "다시 로그인해 주세요." }, 401);
  const caller = await me.json();
  const prof = await (await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=approved&id=eq.${caller.id}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  })).json();
  if (!Array.isArray(prof) || !prof[0]?.approved) return json({ error: "승인된 회원만 쓸 수 있어요." }, 403);

  let body: { images?: { media_type?: string; data?: string }[] };
  try { body = await req.json(); } catch { return json({ error: "요청을 읽지 못했어요." }, 400); }
  const images = Array.isArray(body.images) ? body.images : [];
  if (!images.length) return json({ error: "캡처를 올려 주세요." }, 400);
  if (images.length > MAX_IMAGES) return json({ error: `캡처는 한 번에 ${MAX_IMAGES}장까지 읽을 수 있어요.` }, 400);
  for (const im of images) {
    if (!TYPES.includes(String(im.media_type)) || typeof im.data !== "string" || !im.data || im.data.length > MAX_B64) {
      return json({ error: "이미지가 너무 크거나 읽을 수 없는 형식이에요." }, 400);
    }
  }

  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const client = new Anthropic({ apiKey: API_KEY });
  try {
    const res = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{
        role: "user",
        content: [
          ...images.map((im) => ({ type: "image" as const, source: { type: "base64" as const, media_type: im.media_type as "image/png", data: im.data as string } })),
          { type: "text" as const, text: prompt(today) },
        ],
      }],
    // deno-lint-ignore no-explicit-any
    } as any);
    if (res.stop_reason === "refusal") return json({ error: "이 캡처는 읽지 못했어요." }, 422);
    if (res.stop_reason === "max_tokens") return json({ error: "캡처가 너무 길어요. 나눠서 올려 주세요." }, 422);
    // deno-lint-ignore no-explicit-any
    const text = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join("");
    const out = JSON.parse(text);
    return json({ items: Array.isArray(out.items) ? out.items : [] });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: "지금 요청이 많아요. 잠시 뒤 다시 해 주세요." }, 429);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "캡처 읽기 설정(API 키)을 확인해 주세요." }, 500);
    if (e instanceof Anthropic.BadRequestError) return json({ error: "캡처를 읽지 못했어요. 다른 캡처로 해 주세요." }, 400);
    if (e instanceof Anthropic.APIError) return json({ error: "캡처 읽기 서버에 문제가 있어요. 잠시 뒤 다시 해 주세요." }, 502);
    if (e instanceof SyntaxError) return json({ error: "읽은 결과를 정리하지 못했어요. 다시 해 주세요." }, 502);
    return json({ error: "캡처를 읽지 못했어요." }, 500);
  }
});
