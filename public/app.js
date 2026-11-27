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
// なめらかスクロール（Lenis）。公開ページのみ・動きを減らす設定の端末では使わない。
// スマホの指スクロールは標準のまま（Lenis既定）。
if (
  window.Lenis &&
  !matchMedia("(prefers-reduced-motion: reduce)").matches &&
  !document.body.classList.contains("admin-body")
) {
  // ページ内リンクの止まる位置は CSS の scroll-padding-top（固定ヘッダー分）に従う
  window.tbizLenis = new window.Lenis({
    autoRaf: true,
    lerp: 0.1,
    anchors: true,
  });
}
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
    const card = e.target.closest?.(".post-card, .feature-card");
    if (!card) return;
    card.classList.add("is-touched");
    setTimeout(() => card.classList.remove("is-touched"), 600);
  },
  { passive: true },
);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const slider = document.querySelector(".hero-slider");
if (slider) {
  const viewport = slider.querySelector(".slider-viewport");
  const count = slider.querySelectorAll(".slide").length;
  if (window.EmblaCarousel && viewport && count > 1) initEmblaSlider(slider);
  else initPeekSlider(slider);
}
// スライドショー（Embla）：指のスワイプ・マウスのドラッグで切り替え。
// 見た目（中央のカード＋左右45px・矢印・一時停止・進行バー・5秒自動送り）は従来どおり。
function initEmblaSlider(slider) {
  const viewport = slider.querySelector(".slider-viewport");
  const slides = [...slider.querySelectorAll(".slide")],
    dots = [...slider.querySelectorAll(".slider-dot")],
    pause = slider.querySelector(".slider-pause");
  // 横並びのレイアウトにしてから Embla を起動する（先に起動すると大きさを測り違える）
  slider.classList.add("is-embla");
  const embla = window.EmblaCarousel(viewport, {
    loop: true,
    align: "center",
    duration: 32,
    skipSnaps: false,
  });
  let timer,
    manualPaused = reduceMotion,
    hovered = false,
    focused = false,
    dragging = false;
  const n = slides.length;
  const go = (i) => embla.scrollTo(i, reduceMotion);
  const mark = () => {
    const index = embla.selectedScrollSnap();
    slides.forEach((s, i) => {
      const d = (i - index + n) % n;
      s.classList.toggle("is-active", i === index);
      s.classList.toggle("is-side", d === 1 || d === n - 1);
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
  const stop = () => {
    clearInterval(timer);
    timer = null;
  };
  const update = () => {
    stop();
    if (pause) pause.textContent = manualPaused ? "再生" : "一時停止";
    if (!manualPaused && !hovered && !focused && !dragging && !document.hidden)
      timer = setInterval(() => embla.scrollNext(reduceMotion), 5000);
    slider.classList.toggle("is-playing", Boolean(timer));
  };
  embla.on("select", () => {
    mark();
    update();
  });
  embla.on("pointerDown", () => {
    dragging = true;
    update();
  });
  embla.on("pointerUp", () => {
    dragging = false;
    update();
  });
  slider
    .querySelector(".prev")
    ?.addEventListener("click", () => embla.scrollPrev(reduceMotion));
  slider
    .querySelector(".next")
    ?.addEventListener("click", () => embla.scrollNext(reduceMotion));
  dots.forEach((d, i) => d.addEventListener("click", () => go(i)));
  // 左右の写真を押すとその写真へ移動（ドラッグ直後のクリックは Embla が自動で無効にする）
  slides.forEach((sl, i) =>
    sl.addEventListener("click", (e) => {
      if (i !== embla.selectedScrollSnap()) {
        e.preventDefault();
        go(i);
      }
    }),
  );
  pause?.addEventListener("click", () => {
    manualPaused = !manualPaused;
    update();
  });
  slider.addEventListener("pointerenter", (e) => {
    if (e.pointerType !== "mouse") return;
    hovered = true;
    update();
  });
  slider.addEventListener("pointerleave", (e) => {
    if (e.pointerType !== "mouse") return;
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
  slider.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") embla.scrollPrev(reduceMotion);
    if (e.key === "ArrowRight") embla.scrollNext(reduceMotion);
  });
  document.addEventListener("visibilitychange", update);
  mark();
  update();
}
function initPeekSlider(slider) {
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

// スクロールで見出しやカードがふわっと出る（Motion）。最初から画面内にあるものは動かさない。
if (
  window.Motion &&
  !reduceMotion &&
  !document.body.classList.contains("admin-body")
) {
  const { animate, inView } = window.Motion;
  const targets = document.querySelectorAll(
    "main .section-title, main .page-intro h1, .post-card, .feature, .feature-card, .cta, .quick-search, .site-footer-brand, .site-footer-col",
  );
  targets.forEach((el) => {
    if (el.getBoundingClientRect().top < innerHeight * 0.9) return;
    const siblings = el.parentElement ? [...el.parentElement.children] : [];
    const delay = el.matches(".post-card, .feature-card, .site-footer-col")
      ? (siblings.indexOf(el) % 3) * 0.08
      : 0;
    el.style.opacity = "0";
    el.style.transform = "translateY(18px)";
    const stopWatching = inView(
      el,
      () => {
        stopWatching?.();
        animate(
          el,
          { opacity: 1, transform: "translateY(0px)" },
          { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] },
        ).then(() => {
          el.style.removeProperty("transform");
          el.style.removeProperty("opacity");
        });
      },
      { amount: 0.15 },
    );
  });
}
const search = document.querySelector(".search-form");
// 業界はインタビュー、コンテンツは活動記録のときだけ表示・送信する
const chipOf = (a) =>
  a.type === "インタビュー"
    ? a.industry
    : a.type === "活動記録"
      ? a.activityKind
      : null;
function syncTypeFields(form) {
  const type = form.querySelector("[name=type]")?.value || "";
  form.dataset.type = type;
  for (const label of form.querySelectorAll("[data-for-type]")) {
    const on = label.dataset.forType === type;
    label.hidden = !on;
    const select = label.querySelector("select");
    if (select) select.disabled = !on;
  }
}
if (search) {
  search
    .querySelector("[name=type]")
    ?.addEventListener("change", () => syncTypeFields(search));
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
                  chipOf(a)
                    ? `<div class="card-chips"><span class="chip chip-industry">${escapeHTML(chipOf(a))}</span></div>`
                    : ""
                }<h3>${escapeHTML(a.title)}</h3>${a.lead ? `<p class="card-lead">${escapeHTML(a.lead)}</p>` : ""}<div class="card-foot"><span class="card-meta">${a.type ? `<span class="card-type">${escapeHTML(a.type)}</span>` : ""}</span><span class="card-arrow" aria-hidden="true">→</span></div></div><span class="sr-only">（noteで読む・新しいタブで開く）</span></a></article>`,
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
// 記事カードの上で、マウスカーソルを黒い丸＋矢印に変える。
// マウスで操作するパソコンだけ（スマホ・タッチ・動きを減らす設定では何もしない）。
if (
  matchMedia("(hover: hover) and (pointer: fine)").matches &&
  !matchMedia("(prefers-reduced-motion: reduce)").matches
) {
  // 丸いカーソルを出す場所：記事カード、リンク付きのスライド、Join Our Circle
  const CURSOR_TARGETS =
    ".post-card:not(.post-card-placeholder), .feature-card, .hero-slider a.slide-inner, .join-band[data-href]";
  const dot = document.createElement("div");
  dot.className = "cursor-follow";
  dot.setAttribute("aria-hidden", "true");
  dot.innerHTML =
    '<div class="cursor-follow-dot"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></div>';
  document.body.append(dot);
  document.documentElement.classList.add("has-cursor-follow");
  let tx = -200,
    ty = -200,
    x = tx,
    y = ty,
    frame = 0;
  const step = () => {
    // 少し遅れてなめらかについてくる
    x += (tx - x) * 0.22;
    y += (ty - y) * 0.22;
    dot.style.setProperty("--x", x.toFixed(1) + "px");
    dot.style.setProperty("--y", y.toFixed(1) + "px");
    frame =
      Math.abs(tx - x) + Math.abs(ty - y) > 0.3
        ? requestAnimationFrame(step)
        : 0;
  };
  document.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType !== "mouse") return;
      tx = e.clientX;
      ty = e.clientY;
      if (!dot.classList.contains("is-on")) {
        x = tx;
        y = ty;
      }
      dot.classList.toggle(
        "is-on",
        Boolean(e.target.closest?.(CURSOR_TARGETS)),
      );
      // 暗い背景（Join Our Circle）の上では白い丸にする
      dot.classList.toggle("is-light", Boolean(e.target.closest?.(".join-band")));
      if (!frame) frame = requestAnimationFrame(step);
    },
    { passive: true },
  );
  document.addEventListener("pointerleave", () =>
    dot.classList.remove("is-on"),
  );
  addEventListener("blur", () => dot.classList.remove("is-on"));
}
// Join Our Circle：欄のどこを押しても see more と同じページへ（キーボードは see more のリンクで操作）
document.querySelector(".join-band[data-href]")?.addEventListener("click", (e) => {
  if (e.target.closest("a")) return;
  const band = e.currentTarget;
  const href = band.dataset.href;
  // サイトの外と新歓特設ページは別タブで開く
  if (/^https:/.test(href) || href === "/shinkan") window.open(href, "_blank", "noopener");
  else location.assign(href);
});
// 少しスクロールしたら html に is-scrolled を付ける（ヘッダーのロゴを隠し、メニューだけ残す）
{
  const mark = () =>
    document.documentElement.classList.toggle("is-scrolled", scrollY > 24);
  mark();
  addEventListener("scroll", mark, { passive: true });
}
// ヘッダーのメニュー（パソコン）：Menu を押すと開閉。外側を押すと閉じる
{
  const pills = document.querySelector(".nav-pills");
  const toggle = pills?.querySelector(".nav-pills-toggle");
  if (pills && toggle) {
    const set = (open) => {
      pills.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "メニューを閉じる" : "メニューを開く");
    };
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      set(!pills.classList.contains("is-open"));
    });
    document.addEventListener("click", (e) => {
      if (!pills.contains(e.target)) set(false);
    });
    // マウスが離れたら閉じる（指で開いたときは、外側を押すまで開いたまま）
    pills.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse") set(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") set(false);
    });
  }
}
// 紹介ブロック：色とりどりの図形を最初から置き、漂いながら形を変え続ける（サークルのフレッシュさと「やりたいを形にする」可塑性の表現）
{
  const box = document.querySelector(".intro-dots");
  const band = box?.closest(".intro-band");
  if (box && band) {
    const r = (a, b) => a + Math.random() * (b - a);
    // 図形は新歓ページと同じ色で3つまで（スマホは2つ）。コピーと写真には重ねない
    const n = innerWidth < 768 ? 2 : 3;
    const colors = ["#e5484d", "#f2b705", "#2f5bd8"];
    const kinds = ["circle", "triangle", "circle"];
    const photo = band.querySelector(".th-photos, .intro-photo");
    const br = band.getBoundingClientRect();
    const pr = photo ? photo.getBoundingClientRect() : null;
    const rel = (el, pad = 0) => {
      const q = el.getBoundingClientRect();
      return { l: q.left - br.left - pad, r: q.right - br.left + pad, t: q.top - br.top - pad, b: q.bottom - br.top + pad };
    };
    const avoid = [...band.querySelectorAll(".th-copy, .intro-label, .intro-catch, .intro-body p, .intro-btn")].map((el) => rel(el, 24));
    if (photo) avoid.push(rel(photo, 0));
    for (let i = 0; i < n; i++) {
      const kind = kinds[i % kinds.length];
      const size = Math.round(r(18, 40));
      // 文章と写真の上には置かない（読みやすさのため）。空いている場所を探す
      let x = 0,
        y = 0;
      for (let t = 0; t < 40; t++) {
        x = r(0.02, 0.98) * br.width;
        y = r(0.04, 0.96) * br.height;
        if (!avoid.some((a) => x > a.l - size && x < a.r + size && y > a.t - size && y < a.b + size)) break;
      }
      const el = document.createElement("span");
      el.className = "intro-shape";
      el.style.cssText = `left:${x.toFixed(0)}px;top:${y.toFixed(0)}px;--s:${size}px;--c:${colors[i % colors.length]};--o:${r(0.55, 0.85).toFixed(2)}`;
      const inner = document.createElement("span");
      inner.className = `intro-shape-in is-${kind}`;
      inner.style.cssText = [
        `--dx:${Math.round(r(-90, 90))}px`,
        `--dy:${Math.round(r(-70, 70))}px`,
        `--rot:${Math.round(r(-60, 60))}deg`,
        `--d:${r(20, 32).toFixed(1)}s`,
        `--m:${r(12, 20).toFixed(1)}s`,
        `--delay:${(-r(0, 20)).toFixed(1)}s`,
      ].join(";");
      el.append(inner);
      box.append(el);
    }
  }
}
// 記事欄の右下の図形：画面に入ったら左から順に現れる
{
  const decos = document.querySelectorAll(".section-deco");
  if (decos.length && "IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
      },
      { threshold: 0.4 },
    );
    decos.forEach((d) => io.observe(d));
  } else decos.forEach((d) => d.classList.add("is-in"));
}
