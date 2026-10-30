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
  const show = (n) => {
    index = (n + slides.length) % slides.length;
    slides.forEach((s, i) => {
      s.classList.toggle("is-active", i === index);
      s.setAttribute("aria-hidden", String(i !== index));
      s.querySelectorAll("a").forEach(
        (a) => (a.tabIndex = i === index ? 0 : -1),
      );
    });
    dots.forEach((d, i) => {
      d.classList.toggle("is-active", i === index);
      d.setAttribute("aria-pressed", String(i === index));
    });
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
                `<article class="card"><a href="/go/${escapeHTML(a.id)}" target="_blank" rel="noopener noreferrer"><div class="thumb">${a.imageUrl ? `<img src="${escapeHTML(a.imageUrl)}" alt="" loading="lazy" width="640" height="360">` : ""}</div><div class="card-body"><div class="card-tags">${[
                  a.industry,
                  a.type,
                ]
                  .filter(Boolean)
                  .map((t) => `<span class="pill">${escapeHTML(t)}</span>`)
                  .join(
                    "",
                  )}</div><h3>${escapeHTML(a.title)}</h3><time class="date" datetime="${escapeHTML(a.publishedAt)}">${escapeHTML(new Date(a.publishedAt).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }))}</time></div></a></article>`,
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
