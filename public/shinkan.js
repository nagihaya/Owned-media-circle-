"use strict";
// 新歓ページ：メンバーのカードを押すと裏返って Q&A を表示（もう一度押すと戻る）
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".skm-flip");
  if (!btn) return;
  const on = btn.getAttribute("aria-pressed") !== "true";
  btn.setAttribute("aria-pressed", String(on));
  btn.setAttribute("aria-label", on ? "カードを表に戻す" : "カードを裏返してQ&Aを見る");
});
