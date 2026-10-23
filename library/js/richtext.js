// 감상 서식 (일기장과 같은 방식): 굵게, 기울임, 취소선, 형광펜, 글씨 색. 저장·표시 전에 허용한 서식만 남김
import { RICH_MARK, isRich, plainText } from "./library.js?v=202610230926";

export const HIGHLIGHTS = [
  { name: "노랑", value: "rgba(255, 212, 0, 0.45)" },
  { name: "초록", value: "rgba(64, 192, 87, 0.35)" },
  { name: "분홍", value: "rgba(240, 101, 149, 0.35)" },
  { name: "하늘", value: "rgba(77, 171, 247, 0.35)" },
];
export const COLORS = [
  { name: "빨강", value: "#e03131" },
  { name: "주황", value: "#f08c00" },
  { name: "초록", value: "#2f9e44" },
  { name: "파랑", value: "#1c7ed6" },
  { name: "보라", value: "#9c36b5" },
  { name: "회색", value: "#868e96" },
];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+\s*)?\))$/i;
const TAGS = { B: "b", STRONG: "b", I: "i", EM: "i", S: "s", STRIKE: "s", DEL: "s", MARK: "mark", DIV: "div", P: "div" };

/** 허용한 태그와 색만 남긴 HTML */
export function sanitize(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const walk = (node) => [...node.childNodes].map((n) => {
    if (n.nodeType === Node.TEXT_NODE) return esc(n.textContent);
    if (n.nodeType !== Node.ELEMENT_NODE) return "";
    if (n.tagName === "BR") return "<br>";
    if (["SCRIPT", "STYLE", "TEMPLATE", "IFRAME", "OBJECT", "SVG", "MATH"].includes(n.tagName.toUpperCase())) return "";
    let inner = walk(n);
    const st = n.style;
    // 색은 span 하나로 모음 (font color=… 도 받아 줌)
    const color = n.tagName === "FONT" ? n.getAttribute("color") : st?.color;
    const bg = st?.backgroundColor;
    const css = [color && SAFE_COLOR.test(color) ? `color:${color}` : "", bg && SAFE_COLOR.test(bg) && bg !== "rgba(0, 0, 0, 0)" ? `background-color:${bg}` : ""].filter(Boolean).join(";");
    if (st?.fontWeight === "bold" || Number(st?.fontWeight) >= 600) inner = `<b>${inner}</b>`;
    if (st?.fontStyle === "italic") inner = `<i>${inner}</i>`;
    if (st?.textDecorationLine?.includes("line-through") || st?.textDecoration?.includes("line-through")) inner = `<s>${inner}</s>`;
    if (css) inner = `<span style="${css}">${inner}</span>`;
    const tag = TAGS[n.tagName];
    return tag ? `<${tag}>${inner}</${tag}>` : inner;
  }).join("");
  return walk(tpl.content);
}

/** 읽기 화면용 HTML. 예전 글(그냥 글)은 글자 그대로 */
export const toHtml = (content) => (isRich(content) ? sanitize(content.slice(RICH_MARK.length)) : esc(content));

/** 서식 도구 막대 + 입력칸. getValue()는 저장할 본문(내용이 없으면 "") */
export function richEditor(host, initial, onChange) {
  host.innerHTML = `<div class="rt-bar" role="toolbar" aria-label="글자 서식">
      <button type="button" class="rt-btn" data-cmd="bold" aria-label="굵게" aria-pressed="false"><b>B</b></button>
      <button type="button" class="rt-btn" data-cmd="italic" aria-label="기울임" aria-pressed="false"><i>I</i></button>
      <button type="button" class="rt-btn" data-cmd="strikeThrough" aria-label="취소선" aria-pressed="false"><s>S</s></button>
      <span class="rt-sep"></span>
      <button type="button" class="rt-btn" data-pal="hl" aria-expanded="false"><span class="rt-hl">형광펜</span></button>
      <button type="button" class="rt-btn" data-pal="fc" aria-expanded="false"><span class="rt-fc">글씨 색</span></button>
      <span class="rt-sep"></span>
      <button type="button" class="rt-btn" data-cmd="removeFormat">서식 지우기</button>
    </div>
    <div class="rt-pal" data-for="hl" hidden>${HIGHLIGHTS.map((h) => `<button type="button" class="rt-sw" data-hl="${h.value}" style="background:${h.value}" aria-label="형광펜 ${h.name}"></button>`).join("")}
      <button type="button" class="rt-btn" data-hl="transparent">형광펜 지우기</button></div>
    <div class="rt-pal" data-for="fc" hidden>${COLORS.map((c) => `<button type="button" class="rt-sw" data-fc="${c.value}" style="background:${c.value}" aria-label="글씨 색 ${c.name}"></button>`).join("")}</div>
    <div class="lined editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="내용" data-placeholder="자유롭게 감상을 남겨 보세요…"></div>`;
  const ed = host.querySelector(".editor");
  ed.innerHTML = isRich(initial) ? sanitize(initial.slice(RICH_MARK.length)) : esc(initial).replace(/\n/g, "<br>");

  const getValue = () => {
    const html = sanitize(ed.innerHTML);
    return plainText(RICH_MARK + html).trim() ? RICH_MARK + html : "";
  };
  const emit = () => { ed.classList.toggle("empty", !ed.textContent.trim() && !ed.querySelector("img")); onChange(getValue()); };
  ed.classList.toggle("empty", !ed.textContent.trim());

  const run = (cmd, value) => {
    ed.focus();
    document.execCommand("styleWithCSS", false, cmd === "hiliteColor" || cmd === "foreColor");
    document.execCommand(cmd, false, value);
    emit(); syncState();
  };
  const syncState = () => host.querySelectorAll("[data-cmd]").forEach((b) => {
    if (b.dataset.cmd === "removeFormat") return;
    try { b.setAttribute("aria-pressed", String(document.queryCommandState(b.dataset.cmd))); } catch { /* 지원 안 하면 표시만 생략 */ }
  });

  // 버튼을 눌러도 입력칸의 선택 영역이 풀리지 않게
  host.querySelector(".rt-bar").addEventListener("mousedown", (e) => e.preventDefault());
  host.querySelectorAll(".rt-pal").forEach((p) => p.addEventListener("mousedown", (e) => e.preventDefault()));
  host.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.cmd) run(b.dataset.cmd);
    else if (b.dataset.pal) {
      host.querySelectorAll(".rt-pal").forEach((p) => { p.hidden = p.dataset.for !== b.dataset.pal || !p.hidden; });
      host.querySelectorAll("[data-pal]").forEach((x) => x.setAttribute("aria-expanded", String(!host.querySelector(`.rt-pal[data-for="${x.dataset.pal}"]`).hidden)));
    } else if (b.dataset.hl) run("hiliteColor", b.dataset.hl);
    else if (b.dataset.fc) run("foreColor", b.dataset.fc);
  });
  ed.addEventListener("input", emit);
  ed.addEventListener("keyup", syncState);
  ed.addEventListener("mouseup", syncState);
  // 다른 곳에서 복사해 온 글은 서식 없이 붙임
  ed.addEventListener("paste", (e) => {
    e.preventDefault();
    document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
  });
  return { getValue };
}
