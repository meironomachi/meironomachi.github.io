// 개표 결과 판정: 단독 과반이면 당선, 아니면 1·2위 결선. 결선은 많이 얻은 쪽이 당선
// data = { basis: "valid"|"turnout", first: { votes: {1..4}, eligible, turnout, invalid, counted, final }, runoff: { votes: {n: 표}, final } }

const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : 0);

/** 한 차례(1차 또는 결선) 집계: 득표 많은 순, 비율, 과반 기준 */
export function count(votes, ids, { basis = "valid", turnout = 0, invalid = 0 } = {}) {
  const rows = ids.map((n) => ({ n, votes: num(votes?.[n]) }));
  const valid = rows.reduce((t, r) => t + r.votes, 0);
  // 투표수 기준: 적어 둔 투표수가 있으면 그것, 없으면 유효표 + 무효표
  const base = basis === "turnout" ? Math.max(num(turnout), valid + num(invalid)) : valid;
  for (const r of rows) {
    r.pct = valid ? (r.votes / valid) * 100 : 0; // 막대는 유효표 대비
    r.basePct = base ? (r.votes / base) * 100 : 0; // 과반 판단은 기준 대비
    r.majority = base > 0 && r.votes * 2 > base;
  }
  rows.sort((a, b) => b.votes - a.votes || a.n - b.n);
  return { rows, valid, base };
}

/** 1차 투표 판정 */
export function judgeFirst(data, ids = [1, 2, 3, 4]) {
  const f = data?.first ?? {};
  const c = count(f.votes, ids, { basis: data?.basis, turnout: f.turnout, invalid: f.invalid });
  const [a, b, third] = c.rows;
  const started = c.valid > 0;
  const final = !!f.final && started;
  let winner = null, runoff = null, tie = null;
  if (started) {
    if (a.majority && a.votes > b.votes) winner = a.n;
    else {
      runoff = [a.n, b.n].sort((x, y) => x - y); // 결선 진출 두 팀은 기호 순
      if (a.votes === b.votes && third && b.votes === third.votes) tie = "top"; // 1·2·3위 동률
      else if (third && b.votes === third.votes) tie = "second"; // 2위 동률: 결선 진출 팀을 정할 수 없음
    }
  }
  return { ...c, started, final, winner, runoff, tie };
}

/** 결선 판정 (1차에서 결선이 확정됐을 때만) */
export function judgeRunoff(data, pair) {
  const r = data?.runoff ?? {};
  const c = count(r.votes, pair, { basis: data?.basis, turnout: r.turnout, invalid: r.invalid });
  const started = c.valid > 0;
  const final = !!r.final && started;
  const [a, b] = c.rows;
  const winner = started && a.votes > b.votes ? a.n : null;
  return { ...c, started, final, winner, tie: started && a.votes === b.votes };
}

/** 화면에 보일 한 줄 상태 */
export function headline(first, runoff) {
  if (!first.started) return { kind: "before", text: "아직 개표 전이에요" };
  if (first.winner) return first.final
    ? { kind: "won", n: first.winner, text: `기호 ${first.winner}번 후보조 당선 (1차 과반)` }
    : { kind: "lead", n: first.winner, text: `개표 중 · 기호 ${first.winner}번 과반 앞섬` };
  if (!first.final) return { kind: "lead", n: first.rows[0].n, text: `개표 중 · 과반 후보조 없음 (지금대로면 결선)` };
  if (first.tie) return { kind: "tie", text: "과반 후보조 없음 · 2위가 같은 표라 결선 진출 팀을 확인해야 해요" };
  if (runoff?.started) {
    if (runoff.final && runoff.winner) return { kind: "won", n: runoff.winner, text: `기호 ${runoff.winner}번 후보조 당선 (결선)` };
    if (runoff.final && runoff.tie) return { kind: "tie", text: "결선 동률 · 규정에 따른 처리를 확인해야 해요" };
    return { kind: "lead", n: runoff.rows[0].n, text: `결선 개표 중 · 기호 ${runoff.rows[0].n}번 앞섬` };
  }
  return { kind: "runoff", text: `과반 후보조 없음 · 기호 ${first.runoff[0]}번과 ${first.runoff[1]}번 결선 진출` };
}
