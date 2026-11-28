"use strict";
// 新歓ページ：メンバーのカードを押す（マウスは乗せる）と裏返って Q&A を表示（もう一度押すと戻る）
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".skm-flip");
  if (!btn) return;
  // マウスでは「乗せると裏返る」ので、クリックでは切り替えない（指とキーボードは押して切り替え）
  if (e.pointerType === "mouse") return;
  const on = btn.getAttribute("aria-pressed") !== "true";
  btn.setAttribute("aria-pressed", String(on));
  btn.setAttribute("aria-label", on ? "カードを表に戻す" : "カードを裏返してQ&Aを見る");
});
// 新歓ページ：メンバー紹介をタグで絞り込む
{
  const filter = document.querySelector(".skm-filter");
  const cards = [...document.querySelectorAll(".skm-card")];
  if (filter && cards.length) {
    const count = filter.querySelector("[data-count]");
    filter.addEventListener("click", (e) => {
      const chip = e.target.closest(".skm-chip");
      if (!chip) return;
      const tag = chip.dataset.tag;
      for (const c of filter.querySelectorAll(".skm-chip"))
        c.setAttribute("aria-pressed", String(c === chip));
      let shown = 0;
      for (const card of cards) {
        let tags = [];
        try {
          tags = JSON.parse(card.dataset.tags || "[]");
        } catch {}
        const on = !tag || tags.includes(tag);
        card.hidden = !on;
        if (on) {
          shown++;
          card.classList.remove("is-in");
          void card.offsetWidth;
          card.classList.add("is-in");
        }
      }
      count.textContent = String(shown);
    });
  }
}
// 新歓ページ：落書きは画面に入ったら描く（1回だけ。動きを減らす設定では最初から描いた状態）
{
  const doodles = document.querySelectorAll(".sk-doodle");
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (doodles.length && !still && "IntersectionObserver" in window) {
    doodles.forEach((d) => d.classList.add("is-pending"));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) {
            e.target.classList.add("is-drawing");
            requestAnimationFrame(() => requestAnimationFrame(() => e.target.classList.remove("is-pending")));
            io.unobserve(e.target);
          }
      },
      { threshold: 0.4 },
    );
    doodles.forEach((d) => io.observe(d));
  }
}
