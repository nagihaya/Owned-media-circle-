"use strict";
const csrf = () =>
  document.querySelector('meta[name="csrf-token"]')?.content || "";
const escapeHTML = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
async function api(url, { method = "GET", body, signal } = {}) {
  const form = body instanceof FormData;
  const r = await fetch(url, {
    method,
    credentials: "same-origin",
    signal,
    headers: {
      ...(form ? {} : { "Content-Type": "application/json" }),
      "X-CSRF-Token": csrf(),
    },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
  });
  let data;
  try {
    data = await r.json();
  } catch {
    throw new Error("サーバーの応答を確認できませんでした。");
  }
  if (!r.ok) throw new Error(data.error || "処理に失敗しました。");
  return data;
}
window.Tbiz = { api, escapeHTML };
document.querySelectorAll("[data-login]").forEach((a) =>
  a.addEventListener("click", (e) => {
    e.preventDefault();
    location.assign(
      "/auth/start?origin=" + encodeURIComponent(location.origin),
    );
  }),
);
// スマホ：三本線ボタンでメニューを開閉
const menuToggle = document.querySelector(".menu-toggle");
const mainNav = document.getElementById("mainNav");
if (menuToggle && mainNav) {
  const setMenu = (open) => {
    menuToggle.setAttribute("aria-expanded", String(open));
    menuToggle.setAttribute(
      "aria-label",
      open ? "メニューを閉じる" : "メニューを開く",
    );
    mainNav.classList.toggle("is-open", open);
    document.documentElement.classList.toggle("menu-open", open);
  };
  menuToggle.addEventListener("click", () =>
    setMenu(menuToggle.getAttribute("aria-expanded") !== "true"),
  );
  mainNav.addEventListener("click", (e) => {
    if (e.target.closest("a")) setMenu(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && mainNav.classList.contains("is-open")) {
      setMenu(false);
      menuToggle.focus();
    }
  });
  matchMedia("(min-width: 801px)").addEventListener("change", (m) => {
    if (m.matches) setMenu(false);
  });
}
// スマホ：記事カードを触った瞬間にふちを黒くする（マウスのない端末向け）
document.addEventListener(
  "touchstart",
  (e) => {
    const card = e.target.closest?.(".post-card");
    if (!card) return;
    card.classList.add("is-touched");
    setTimeout(() => card.classList.remove("is-touched"), 600);
  },
  { passive: true },
);
const slider = document.querySelector(".hero-slider");
if (slider) {
  const slides = [...slider.querySelectorAll(".slide")],
    dots = [...slider.querySelectorAll(".slider-dot")],
    pause = slider.querySelector(".slider-pause");
  let index = 0,
    timer,
    manualPaused = matchMedia("(prefers-reduced-motion: reduce)").matches,
    hovered = false,
    focused = false;
  const stop = () => {
    clearInterval(timer);
    timer = null;
  };
  // 中央の写真からの距離（-1=左隣、0=中央、1=右隣）。端はぐるっと回る
  const offsetOf = (i) => {
    const n = slides.length;
    let d = (((i - index) % n) + n) % n;
    if (d > n / 2) d -= n;
    if (n === 2 && d === -1) d = 1;
    return d;
  };
  const show = (n) => {
    index = (n + slides.length) % slides.length;
    slides.forEach((s, i) => {
      const offset = offsetOf(i);
      const prev = Number(s.style.getPropertyValue("--offset") || offset);
      // 左端から右端へ回り込む写真は、中央を横切らないようアニメーションなしで移動
      if (Math.abs(offset - prev) > 1) {
        s.classList.add("no-anim");
        s.style.setProperty("--offset", offset);
        void s.offsetWidth;
        s.classList.remove("no-anim");
      } else s.style.setProperty("--offset", offset);
      s.classList.toggle("is-active", i === index);
      s.classList.toggle("is-side", Math.abs(offset) === 1);
      s.setAttribute("aria-hidden", String(i !== index));
      s.querySelectorAll("a").forEach(
        (a) => (a.tabIndex = i === index ? 0 : -1),
      );
    });
    dots.forEach((d, i) => {
      d.classList.remove("is-active");
      d.setAttribute("aria-pressed", String(i === index));
    });
    // 進行バーのアニメーションを最初からやり直すため、付け直す
    void dots[index]?.offsetWidth;
    dots[index]?.classList.add("is-active");
  };
  const update = () => {
    stop();
    if (pause) pause.textContent = manualPaused ? "再生" : "一時停止";
    if (
      slides.length > 1 &&
      !manualPaused &&
      !hovered &&
      !focused &&
      !document.hidden
    )
      timer = setInterval(() => show(index + 1), 5000);
    slider.classList.toggle("is-playing", Boolean(timer));
  };
  slider.querySelector(".prev")?.addEventListener("click", () => {
    show(index - 1);
    update();
  });
  slider.querySelector(".next")?.addEventListener("click", () => {
    show(index + 1);
    update();
  });
  dots.forEach((d, i) =>
    d.addEventListener("click", () => {
      show(i);
      update();
    }),
  );
  // 左右に見えている写真を押すと、その写真へ移動（リンクは開かない）
  slides.forEach((sl, i) =>
    sl.addEventListener("click", (e) => {
      if (i === index) return;
      e.preventDefault();
      show(i);
      update();
    }),
  );
  slider.classList.add("is-peek");
  pause?.addEventListener("click", () => {
    manualPaused = !manualPaused;
    update();
  });
  slider.addEventListener("pointerenter", () => {
    hovered = true;
    update();
  });
  slider.addEventListener("pointerleave", () => {
    hovered = false;
    update();
  });
  slider.addEventListener("focusin", () => {
    focused = true;
    update();
  });
  slider.addEventListener("focusout", () =>
    setTimeout(() => {
      focused = slider.contains(document.activeElement);
      update();
    }, 0),
  );
  document.addEventListener("visibilitychange", update);
  if (slides.length) show(0);
  update();
}
const search = document.querySelector(".search-form");
if (search) {
  let timer, controller;
  const grid = document.querySelector("#searchGrid"),
    count = document.querySelector("#resultCount");
  const run = async () => {
    controller?.abort();
    controller = new AbortController();
    const params = new URLSearchParams(new FormData(search));
    if (search.dataset.category)
      params.set("category", search.dataset.category);
    count.textContent = "検索中…";
    try {
      const result = await api("/api/articles?" + params, {
        signal: controller.signal,
      });
      count.textContent = result.total + "件の記事";
      grid.innerHTML = result.items.length
        ? result.items
            .map(
              (a) =>
                `<article class="card post-card"><a class="post-card-link" href="/go/${escapeHTML(a.id)}" target="_blank" rel="noopener noreferrer"><div class="thumb">${a.imageUrl ? `<img src="${escapeHTML(a.imageUrl)}" alt="" loading="lazy" width="640" height="360">` : ""}</div><div class="card-body">${
                  a.industry || a.size
                    ? `<div class="card-chips">${a.industry ? `<span class="chip chip-industry">${escapeHTML(a.industry)}</span>` : ""}${a.size ? `<span class="chip chip-size">${escapeHTML(a.size)}</span>` : ""}</div>`
                    : ""
                }<h3>${escapeHTML(a.title)}</h3>${a.lead ? `<p class="card-lead">${escapeHTML(a.lead)}</p>` : ""}<div class="card-foot"><span class="card-meta">${a.type ? escapeHTML(a.type) + "・" : ""}<time datetime="${escapeHTML(a.publishedAt)}">${escapeHTML(new Date(a.publishedAt).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }))}</time></span><span class="card-arrow" aria-hidden="true">→</span></div></div><span class="sr-only">（noteで読む・新しいタブで開く）</span></a></article>`,
            )
            .join("")
        : '<div class="panel empty-state">条件に一致する記事がありません。</div>';
      params.delete("category");
      history.replaceState(null, "", location.pathname + "?" + params);
      const pagination = document.querySelector(".pagination");
      pagination.innerHTML =
        (result.page > 1
          ? `<a href="?${escapeHTML(new URLSearchParams({ ...Object.fromEntries(params), page: result.page - 1 }))}">前のページ</a>`
          : "") +
        `<span>${result.page} / ${result.pages}</span>` +
        (result.page < result.pages
          ? `<a href="?${escapeHTML(new URLSearchParams({ ...Object.fromEntries(params), page: result.page + 1 }))}">次のページ</a>`
          : "");
    } catch (e) {
      if (e.name !== "AbortError") count.textContent = e.message;
    }
  };
  search.addEventListener("submit", (e) => {
    e.preventDefault();
    clearTimeout(timer);
    run();
  });
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(run, 350);
  });
}
