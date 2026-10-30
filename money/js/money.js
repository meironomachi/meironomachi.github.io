// $TDL 가계부 규칙: 은행 파일 읽기, 취소·이체 판별, 겹침 처리, 월 합계, 예산

/* 종류: 지출·수입만 합계에 들어가고, 이체·저축·취소는 따로 */
export const KINDS = [
  { id: "expense", name: "지출" },
  { id: "income", name: "수입" },
  { id: "transfer", name: "이체" },
  { id: "saving", name: "저축" },
  { id: "cancel", name: "취소" },
];
export const kindName = (id) => KINDS.find((k) => k.id === id)?.name ?? "";

export const DEFAULT_CATEGORIES = [
  ["식비", "expense", "#e8590c"], ["카페", "expense", "#a0522d"], ["교통", "expense", "#1c7ed6"], ["쇼핑", "expense", "#d6336c"],
  ["문화", "expense", "#7048e8"], ["교육", "expense", "#2f9e44"], ["구독", "expense", "#0c8599"], ["통신", "expense", "#5c7cfa"],
  ["의료", "expense", "#e03131"], ["기타", "expense", "#868e96"],
  ["용돈", "income", "#2b8a3e"], ["급여", "income", "#087f5b"], ["기타 수입", "income", "#74b816"],
  ["이체", "transfer", "#868e96"], ["저축", "saving", "#0031b0"],
].map(([name, kind, color], i) => ({ name, kind, color, sort: i }));

export const BANKS = [
  { id: "kakao", name: "카카오뱅크" },
  { id: "hana", name: "하나은행" },
  { id: "nh", name: "농협은행" },
  { id: "cash", name: "현금" },
  { id: "etc", name: "기타" },
];

/* ---------- 날짜 (한국 시간) ---------- */
const KST = 9 * 3600 * 1000;
const pad = (n) => String(n).padStart(2, "0");
/** 한국 시간 기준 YYYY-MM-DD */
export function kstDay(iso) {
  const d = new Date(Date.parse(iso) + KST);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
export const kstMonth = (iso) => kstDay(iso).slice(0, 7);
/** 그 달의 시작과 다음 달 시작 (ISO) */
export function monthRange(month) {
  const [y, m] = month.split("-").map(Number);
  return [new Date(Date.UTC(y, m - 1, 1) - KST).toISOString(), new Date(Date.UTC(y, m, 1) - KST).toISOString()];
}
export function shiftMonth(month, n) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}
/** "2026.10.01 07:03:24" 같은 한국 시각 글자 → ISO */
export function parseKstDateTime(s) {
  const m = String(s ?? "").trim().match(/^(\d{4})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})일?\.?(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const [, y, mo, d, h = 0, mi = 0, s2 = 0] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s2) - KST).toISOString();
}

/* ---------- 금액 ---------- */
export function parseAmount(v) {
  if (typeof v === "number") return Math.round(v);
  const s = String(v ?? "").replace(/[,\s원₩]/g, "");
  if (!s || !/^[-+]?\d+(\.\d+)?$/.test(s)) return null;
  return Math.round(Number(s));
}
export const won = (n) => `${Math.round(n).toLocaleString("ko-KR")}원`;
export const signedWon = (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(Math.round(n)).toLocaleString("ko-KR")}원`;

/* ---------- 은행 파일 읽기 ---------- */
// 제목 줄을 찾아 칸 이름으로 읽음. 카카오뱅크: 거래일시 | 구분 | 거래금액 | 거래 후 잔액 | 거래구분 | 내용 | 메모
// 다른 은행처럼 출금액·입금액이 따로 있는 파일도 읽음
const H = {
  date: /^(거래\s*일시|거래\s*일자|거래일|일시|날짜|거래\s*날짜)$/,
  time: /^(거래\s*시간|시간)$/,
  dir: /^(구분|입출금\s*구분|입출\s*구분|입\s*\/\s*출금?|입출금|입출|입금\s*\/\s*출금|거래\s*유형)$/,
  amount: /^(거래\s*금액|금액)$/,
  out: /^(출금\s*(액|금액)?|찾으신\s*금액|지급\s*금액)(\(원\))?$/,
  in: /^(입금\s*(액|금액)?|맡기신\s*금액)(\(원\))?$/,
  balance: /^(거래\s*후\s*잔액|잔액|거래후잔액)(\(원\))?$/,
  txType: /^(거래\s*구분|적요|거래\s*종류)$/,
  place: /^(내용|거래\s*내용|기재\s*내용|거래\s*기록\s*사항|기록\s*사항|통장\s*표시\s*내용|거래처|가맹점(명)?|받는\s*분|보낸\s*분|상대\s*(계좌)?\s*(예금주)?(명)?|의뢰인|수취인)$/,
  memo: /^(메모|비고)$/,
};
const DIR_ONLY = /^(입금|출금|지급|입|출)$/;
const OUT_WORD = /출금|지급|^출$/, IN_WORD = /입금|^입$/;
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/** 시트의 행들(글자 배열) → 거래 목록 [{occurred_at, amount, balance_after, tx_type, place, memo}] */
export function parseBankRows(rows) {
  const headerIdx = rows.findIndex((r) => r.some((c) => H.date.test(clean(c))) && r.some((c) => H.amount.test(clean(c)) || H.out.test(clean(c))));
  if (headerIdx < 0) return { error: "거래일시와 금액 칸을 찾지 못했어요. 은행에서 받은 거래내역 파일인지 확인해 주세요.", items: [] };
  const header = rows[headerIdx].map(clean);
  const col = {};
  for (const [key, re] of Object.entries(H)) {
    const i = header.findIndex((h, j) => re.test(h) && !Object.values(col).includes(j));
    if (i >= 0) col[key] = i;
  }
  // 하나은행처럼 '내용' 칸 없이 '적요'에 거래 상대가 적히는 파일: 적요를 거래 상대로
  if (col.place === undefined && col.txType !== undefined && /적요/.test(header[col.txType])) { col.place = col.txType; delete col.txType; }
  const items = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const at = parseKstDateTime(col.time !== undefined ? `${clean(r[col.date])} ${clean(r[col.time])}` : clean(r[col.date]));
    if (!at) continue;
    let amount = null;
    if (col.amount !== undefined) {
      amount = parseAmount(r[col.amount]);
      // 입출금 구분: 구분 칸이 있으면 그 칸, 없으면(또는 칸이 어긋나 비었으면) 줄 안에 "입금"·"출금"만 적힌 칸
      const dir = clean(r[col.dir]) || r.map(clean).find((c) => DIR_ONLY.test(c)) || "";
      if (amount !== null && OUT_WORD.test(dir) && amount > 0) amount = -amount;
      if (amount !== null && IN_WORD.test(dir) && amount < 0) amount = -amount;
    } else {
      const o = parseAmount(r[col.out]) ?? 0, i = parseAmount(r[col.in]) ?? 0;
      amount = i - Math.abs(o);
    }
    if (!amount) continue;
    items.push({
      occurred_at: at, amount,
      balance_after: col.balance !== undefined ? parseAmount(r[col.balance]) : null,
      tx_type: clean(r[col.txType]), place: clean(r[col.place]), memo: clean(r[col.memo]),
    });
  }
  return { error: items.length ? null : "읽을 거래가 없어요.", items };
}

/** 캡처에서 읽은 줄({date "YYYY-MM-DD", time "HH:MM", amount, counterparty, balance_after, tx_type}) → 거래 목록.
 * 캡처를 나눠 읽을 때 겹친 부분의 같은 줄은 하나만 남김 */
export function fromScreenshotRows(rows) {
  const seen = new Set(), items = [];
  for (const r of rows ?? []) {
    const at = parseKstDateTime(`${clean(r.date)} ${clean(r.time)}`);
    const amount = parseAmount(r.amount);
    if (!at || !amount) continue;
    const it = { occurred_at: at, amount, balance_after: r.balance_after == null ? null : parseAmount(r.balance_after), tx_type: clean(r.tx_type), place: clean(r.counterparty), memo: "" };
    const k = `${it.occurred_at}|${it.amount}|${it.balance_after ?? ""}|${it.place}`;
    if (seen.has(k)) continue;
    seen.add(k); items.push(it);
  }
  return items;
}

/* ---------- 캡처 글자 붙여넣기 (아이폰 텍스트 인식으로 복사한 글자) ---------- */
// 하나원큐: "2026.10.26 (월)" 날짜 줄 아래로 [시각(초) · 이름 · 거래구분 · ±금액 · 잔액 · (메모)]
// NH: [2026.10.16 15:11 · 이름 · 금액 · 잔액]. 들어온 돈은 + 없이 숫자만이라, −가 붙은 것만 나간 돈
const P_DATETIME = /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})\.?\s+(\d{1,2}:\d{2}(?::\d{2})?)/;
const P_DATE = /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})\.?(?:\s*\(?[월화수목금토일]\)?)?/;
const P_TIME = /(?<![\d:])(\d{1,2}:\d{2}(?::\d{2})?)(?![\d:])/;
const P_AMOUNT = /([+\-−–]?)\s?(\d{1,3}(?:,\d{3})+|\d+)\s?원/;
const TX_TYPES = /^(체크카드|신용카드|대체|이체|타행이체|타행입금|당행이체|입금|출금|ATM|자동이체|급여|이자|오픈뱅킹|인터넷|모바일|스마트폰|펌뱅킹|CMS|카드|현금|결제|환불)$/i;
// 화면 위쪽 메뉴 같은 글자 (거래 줄이 아님)
const NOISE = /^(거래내역조회|입출금\s*거래내역\s*조회|거래내역|전체|최신순|과거순|잔액|입금|출금|\d+개월|오늘|어제|조회|지금입장|LTE|5G|더보기)$/;
const pad2 = (n) => String(n).padStart(2, "0");

/** 복사한 글자 → 거래 줄 [{date "YYYY-MM-DD"|"", time, amount, place, balance_after, tx_type, memo}] */
export function parsePastedHistory(text) {
  const rows = [];
  let date = "", cur = null;
  const close = () => {
    if (cur?.amount) {
      // "출금"·"입금"이 따로 적혀 있으면 부호보다 그 말을 따름
      if (cur.dir) cur.amount = cur.dir * Math.abs(cur.amount);
      delete cur.dir;
      rows.push(cur);
    }
    cur = null;
  };
  const start = (d, t) => { close(); cur = { date: d, time: t.length === 4 ? `0${t}` : t, amount: 0, place: "", balance_after: null, tx_type: "", memo: "" }; };
  for (let line of String(text ?? "").split(/\r?\n/)) {
    line = clean(line);
    if (!line || /~/.test(line)) continue; // 조회 기간 줄
    // 한 줄에 여러 조각이 붙어 있을 수 있어 앞에서부터 차례로 떼어 냄
    while (line) {
      const cand = [
        ["dt", P_DATETIME.exec(line)], ["d", P_DATE.exec(line)], ["t", P_TIME.exec(line)], ["a", P_AMOUNT.exec(line)],
      ].filter(([, m]) => m).sort((x, y) => x[1].index - y[1].index || (x[0] === "dt" ? -1 : 1));
      const [kind, m] = cand[0] ?? [];
      let textPart = clean(m ? line.slice(0, m.index) : line);
      // "입금 김도현"처럼 앞에 붙은 입출금 말은 떼어 냄
      const lead = cur && textPart.match(/^(입금|출금|지급)\s+(.+)$/);
      if (lead) { cur.dir = OUT_WORD.test(lead[1]) ? -1 : 1; textPart = lead[2]; }
      if (textPart) {
        if (cur && DIR_ONLY.test(textPart)) cur.dir = OUT_WORD.test(textPart) ? -1 : 1;
        else if (cur && !NOISE.test(textPart)) {
          if (TX_TYPES.test(textPart) && !cur.tx_type) cur.tx_type = textPart;
          else if (/^\(.*\)$/.test(textPart) || cur.place) cur.memo = clean(`${cur.memo} ${textPart.replace(/^\((.*)\)$/, "$1")}`);
          else cur.place = textPart;
        }
      }
      if (!m) break;
      line = clean(line.slice(m.index + m[0].length));
      if (kind === "dt") { date = `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`; start(date, m[4]); }
      else if (kind === "d") { close(); date = `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`; }
      else if (kind === "t") start(date, m[1]);
      else if (kind === "a" && cur) {
        const n = Number(m[2].replace(/,/g, ""));
        if (!cur.amount) cur.amount = m[1] && m[1] !== "+" ? -n : n;
        else if (cur.balance_after === null) cur.balance_after = n;
      }
    }
  }
  close();
  // 여러 캡처를 이어 붙여 겹친 줄은 하나만
  const seen = new Set();
  return rows.filter((r) => { const k = `${r.date}|${r.time}|${r.amount}|${r.balance_after}|${r.place}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/* ---------- PDF 거래내역서 ---------- */
// PDF에는 표가 없고 글자 조각과 위치만 있음. 줄(lines: [{page, y, h, cells: [{x0, x1, text}]}], 위→아래)을 받아
// 제목 줄의 칸 위치에 맞춰 칸을 나눔. 날짜 칸이 비어 있는 줄(두 줄로 쓴 시각·내용)은 바로 위 거래에 이어 붙임
export function alignPdfRows(lines) {
  const isHead = (l) => l.cells.some((c) => H.date.test(clean(c.text))) && l.cells.some((c) => H.amount.test(clean(c.text)) || H.out.test(clean(c.text)));
  const hi = lines.findIndex(isHead);
  if (hi < 0) return null;
  const names = lines[hi].cells.slice().sort((a, b) => a.x0 - b.x0).map((c) => clean(c.text));
  let centers;
  const useHead = (l) => {
    // 쪽마다 칸 위치가 조금씩 달라도 맞도록, 제목 줄을 만날 때마다 이름별로 칸 위치를 다시 잡음
    const next = names.map(() => null);
    for (const c of l.cells) { const i = names.indexOf(clean(c.text)); if (i >= 0) next[i] = (c.x0 + c.x1) / 2; }
    centers = next.map((x, i) => x ?? centers?.[i] ?? 0);
  };
  useHead(lines[hi]);
  const colOf = (c) => {
    const m = (c.x0 + c.x1) / 2;
    let best = 0;
    for (let i = 1; i < centers.length; i++) if (Math.abs(centers[i] - m) < Math.abs(centers[best] - m)) best = i;
    return best;
  };
  const dateCol = names.findIndex((n) => H.date.test(n));
  const numCols = new Set(names.map((n, i) => (H.amount.test(n) || H.out.test(n) || H.in.test(n) || H.balance.test(n) ? i : -1)).filter((i) => i >= 0));
  const rows = [names];
  let prev = null; // 마지막 거래 줄 {cells, line}
  for (const l of lines.slice(hi + 1)) {
    if (isHead(l)) { useHead(l); prev = null; continue; } // 다음 쪽의 제목 줄
    const cells = names.map(() => "");
    for (const c of l.cells.slice().sort((a, b) => a.x0 - b.x0)) {
      const i = colOf(c);
      // 금액과 옆 칸 글자가 한 조각으로 붙어 나온 경우 ("7,100 (주)가게"): 금액은 금액 칸, 글자는 오른쪽 칸으로
      const m = clean(c.text).match(/^(-?\d{1,3}(?:,\d{3})+|-?\d+)\s+(\D.*)$/);
      const [a, b] = numCols.has(i) ? [i, i + 1] : [i - 1, i];
      if (m && numCols.has(a) && !numCols.has(b) && b < names.length && !cells[a]) { cells[a] = m[1]; cells[b] = clean(`${cells[b]} ${m[2]}`); continue; }
      cells[i] = clean(`${cells[i]} ${c.text}`);
    }
    if (parseKstDateTime(cells[dateCol])) { prev = { cells, line: l }; rows.push(cells); continue; }
    // 이어지는 줄(칸 안에서 위아래로 나뉜 글자): 같은 쪽, 바로 아래일 때만. 금액 칸은 비어 있을 때만 채움
    if (prev && prev.line.page === l.page && Math.abs(l.y - prev.line.y) < 2.6 * (l.h || 10)) {
      cells.forEach((t, i) => {
        if (!t) return;
        if (!numCols.has(i)) prev.cells[i] = clean(`${prev.cells[i]} ${t}`);
        else if (!prev.cells[i]) prev.cells[i] = t;
      });
      prev.line = l;
    } else prev = null;
  }
  return rows;
}

/** 같은 계좌의 같은 거래인지 알아보는 열쇠 */
export const importKey = (accountId, t) => `${accountId}|${t.occurred_at}|${t.amount}|${t.balance_after ?? ""}`;

/* ---------- 분류 ---------- */
export const normalizePlace = (s) => clean(s).toLowerCase().replace(/[\s()（）\-_.·]/g, "");

/** 가져온 거래에 종류와 분류를 붙임: 내 규칙 → 거래구분 단서 → 기본 */
export function classify(t, rules, categories) {
  const rule = t.place && rules.find((r) => r.place === normalizePlace(t.place));
  if (rule) return { kind: rule.kind, category_id: rule.category_id };
  const byName = (name) => categories.find((c) => c.name === name)?.id ?? null;
  if (/적금|예금|저축|세이프박스|저금통/.test(`${t.tx_type} ${t.place}`)) return { kind: "saving", category_id: byName("저축") };
  if (t.amount > 0) return { kind: "income", category_id: /용돈/.test(t.place) ? byName("용돈") : /급여|월급/.test(`${t.tx_type} ${t.place}`) ? byName("급여") : null };
  return { kind: "expense", category_id: null };
}

/* ---------- 취소·이체·겹침 ---------- */
const within = (a, b, ms) => Math.abs(Date.parse(a) - Date.parse(b)) <= ms;

/** 결제 뒤 같은 금액이 '취소·환불·체크카드(기타)'로 들어오면 둘 다 취소로 표시할 짝 [[결제, 취소]] */
export function findCancelPairs(txs) {
  const used = new Set(), pairs = [];
  const refunds = txs.filter((t) => t.amount > 0 && /취소|환불|체크카드\s*\(기타\)|승인취소/.test(t.tx_type ?? ""));
  for (const r of refunds) {
    const pay = txs.filter((t) => t.amount === -r.amount && !used.has(t) && t.account_id === r.account_id
      && Date.parse(t.occurred_at) <= Date.parse(r.occurred_at) && within(t.occurred_at, r.occurred_at, 7 * 86400000))
      .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))[0];
    if (pay) { used.add(pay); used.add(r); pairs.push([pay, r]); }
  }
  return pairs;
}

/** 내 계좌끼리 오간 돈: 다른 계좌에서 같은 금액이 10분 안에 나가고 들어온 짝 [[출금, 입금]] */
export function findTransferPairs(txs) {
  const used = new Set(), pairs = [];
  const outs = txs.filter((t) => t.amount < 0 && t.kind !== "cancel").sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  for (const o of outs) {
    const i = txs.find((t) => t.amount === -o.amount && t.account_id !== o.account_id && t.kind !== "cancel" && !used.has(t) && !used.has(o) && within(t.occurred_at, o.occurred_at, 10 * 60000));
    if (i) { used.add(o); used.add(i); pairs.push([o, i]); }
  }
  return pairs;
}

/** 미리 손으로 넣은 거래 중 파일의 거래와 같은 것 (같은 계좌·같은 금액·이틀 안, 가장 가까운 것) */
export function findManualMatch(t, manuals, taken = new Set()) {
  return manuals.filter((m) => !taken.has(m.id) && m.account_id === t.account_id && m.amount === t.amount && within(m.occurred_at, t.occurred_at, 2 * 86400000))
    .sort((a, b) => Math.abs(Date.parse(a.occurred_at) - Date.parse(t.occurred_at)) - Math.abs(Date.parse(b.occurred_at) - Date.parse(t.occurred_at)))[0] ?? null;
}

/* ---------- 합계와 예산 ---------- */
/** 한 달 요약: 수입·지출(이체·저축·취소 빼고), 저축, 분류별 지출 */
export function monthSummary(txs) {
  let income = 0, expense = 0, saving = 0;
  const byCat = {};
  for (const t of txs) {
    if (t.kind === "income") income += t.amount;
    else if (t.kind === "expense") { expense += -t.amount; const k = t.category_id ?? "none"; byCat[k] = (byCat[k] ?? 0) + -t.amount; }
    else if (t.kind === "saving") saving += -t.amount;
  }
  return { income, expense, net: income - expense, saving, byCat };
}

/** 예산 상태: ok(80% 미만) / warn(80% 이상) / over(넘음) */
export function budgetStatus(spent, budget) {
  if (!budget) return { ratio: 0, state: "none" };
  const ratio = spent / budget;
  return { ratio, state: ratio > 1 ? "over" : ratio >= 0.8 ? "warn" : "ok" };
}

/** 지난달 대비 변화율 (%) — 지난달이 0이면 null */
export const changeRate = (now, before) => (before ? Math.round(((now - before) / before) * 100) : null);

/** 계좌 잔액: 잔액이 적힌 가장 최근 거래 + 그 뒤 손으로 넣은 거래들. 잔액 기록이 없으면 시작 잔액 + 합계 */
export function accountBalance(account, txs) {
  const mine = txs.filter((t) => t.account_id === account.id).sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  const lastIdx = mine.map((t) => t.balance_after != null).lastIndexOf(true);
  if (lastIdx < 0) return (account.opening_balance ?? 0) + mine.reduce((s, t) => s + t.amount, 0);
  return mine[lastIdx].balance_after + mine.slice(lastIdx + 1).reduce((s, t) => s + t.amount, 0);
}

/** 자주 쓰는 내역 (빠른 입력 버튼): 최근 손으로 넣은 곳·분류 조합 중 많이 쓴 순 */
export function frequentEntries(txs, limit = 6) {
  const count = new Map();
  for (const t of txs) {
    if (!t.place || t.kind !== "expense") continue;
    const k = `${t.place}|${t.category_id ?? ""}`;
    const c = count.get(k) ?? { place: t.place, category_id: t.category_id, amount: -t.amount, n: 0 };
    c.n++; count.set(k, c);
  }
  return [...count.values()].sort((a, b) => b.n - a.n).slice(0, limit);
}

/* ---------- 고정 수입·지출 (매월 반복) ---------- */
// rec: { kind, amount(양수), day(1~31), start_month "YYYY-MM", end_month "YYYY-MM" 또는 null }
const lastDay = (month) => { const [y, m] = month.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
/** 그 달에 들어가는 날 (31일로 정해도 30일까지인 달은 30일) */
export const recurringDay = (rec, month) => `${month}-${String(Math.min(rec.day, lastDay(month))).padStart(2, "0")}`;
/** 그 달에 해당하는 고정 항목인지 */
export const recurringActive = (rec, month) => month >= rec.start_month && (!rec.end_month || month <= rec.end_month);
/** 오늘(한국 날짜)까지 날짜가 지나 내역으로 만들어야 하는 달들 */
export function recurringDueMonths(rec, today) {
  const out = [];
  for (let m = rec.start_month; m <= today.slice(0, 7) && (!rec.end_month || m <= rec.end_month); m = shiftMonth(m, 1)) {
    if (recurringDay(rec, m) <= today) out.push(m);
  }
  return out;
}
/** 반복 항목 하나 → 그 달의 내역 (한국 시각 오전 9시) */
export function recurringTx(rec, month) {
  const sign = rec.kind === "income" ? 1 : -1;
  return {
    account_id: rec.account_id, occurred_at: new Date(Date.parse(`${recurringDay(rec, month)}T09:00:00+09:00`)).toISOString(),
    amount: sign * Math.abs(rec.amount), kind: rec.kind, category_id: rec.category_id, place: rec.name, memo: "고정",
    recurring_id: rec.id, recurring_month: month,
  };
}
/** 그 달의 고정 항목 합계 (예정 포함) */
export function recurringTotals(recs, month) {
  const t = { income: 0, expense: 0, saving: 0 };
  for (const r of recs) if (recurringActive(r, month)) t[r.kind] += Math.abs(r.amount);
  return t;
}

/* ---------- 수입·저축 목표 ---------- */
/** 목표는 많이 할수록 좋음: done(다 채움) / near(80% 이상) / ok */
export function goalStatus(got, goal) {
  if (!goal) return { ratio: 0, state: "none" };
  const ratio = got / goal;
  return { ratio, state: ratio >= 1 ? "done" : ratio >= 0.8 ? "near" : "ok" };
}
/** 한 달 분류별 수입·저축 합계 */
export function inflowByCat(txs) {
  const out = {};
  for (const t of txs) {
    if (t.kind === "income") out[t.category_id ?? "none"] = (out[t.category_id ?? "none"] ?? 0) + t.amount;
    else if (t.kind === "saving") out[t.category_id ?? "none"] = (out[t.category_id ?? "none"] ?? 0) - t.amount;
  }
  return out;
}
