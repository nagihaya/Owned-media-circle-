"use strict";
// 共通の app.js と同じ名前（api など）がぶつからないよう、関数の中に閉じ込める
(() => {
  const { api, escapeHTML: h } = window.Tbiz;
  const $ = (s) => document.querySelector(s);
  function message(id, text, error = false) {
    const el = $(id);
    if (el) {
      el.textContent = text;
      el.className = "admin-status " + (error ? "status-error" : "status-ok");
    }
  }
  // 時間のかかる操作中は、ボタン内に処理中表示を出す（HIG：activity indicator）
  async function action(button, fn, target = "#globalStatus") {
    button.disabled = true;
    button.classList.add("is-busy");
    button.setAttribute("aria-busy", "true");
    try {
      await fn();
    } catch (e) {
      message(target, e.message, true);
    } finally {
      button.disabled = false;
      button.classList.remove("is-busy");
      button.removeAttribute("aria-busy");
    }
  }
  async function upload(file) {
    const form = new FormData();
    form.append("file", file);
    return (await api("/api/admin/upload", { method: "POST", body: form })).url;
  }
  // ===== タブ：選んだ項目だけを開く =====
  const tabLinks = [...document.querySelectorAll(".admin-tabs a[href^='#']")];
  const tabIds = tabLinks.map((a) => a.getAttribute("href").slice(1));
  function openTab(id, focus = false) {
    if (!tabIds.includes(id)) id = tabIds[0];
    for (const tid of tabIds) {
      const sec = document.getElementById(tid);
      if (sec) sec.hidden = tid !== id;
    }
    for (const a of tabLinks) {
      const on = a.getAttribute("href") === "#" + id;
      a.classList.toggle("is-active", on);
      if (on) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
    history.replaceState(null, "", "#" + id);
    if (focus) document.getElementById(id)?.querySelector("h2")?.focus();
  }
  for (const a of tabLinks)
    a.addEventListener("click", (e) => {
      e.preventDefault();
      openTab(a.getAttribute("href").slice(1), true);
    });
  for (const id of tabIds)
    document
      .getElementById(id)
      ?.querySelector("h2")
      ?.setAttribute("tabindex", "-1");
  openTab(location.hash.slice(1));
  $("#logout").addEventListener("click", () =>
    action($("#logout"), async () => {
      await api("/auth/logout", { method: "POST", body: {} });
      location.assign("/");
    }),
  );
  let config,
    articlePage = 1,
    articles = [],
    editing;
  async function loadSettings() {
    config = await api("/api/admin/settings");
    const f = $("#settingsForm");
    for (const name of [
      "siteName",
      "subtitle",
      "org",
      "noteUrl",
      "tbizUrl",
      "instagramUrl",
      "xUrl",
      "introLabel",
      "introImageAlt",
      "shinkanFaq",
      "aboutLead",
      "aboutHistory",
      "joinTitle",
      "joinText",
      "joinUrl",
      "introCatch",
      "introText",
      "homeStats",
      "homeTimeline",
      "response",
      "contact",
      "policyDate",
    ])
      f.elements[name].value = config[name] || "";
    faq = faqParse(config.shinkanFaq);
    renderFaq();
    if ($("#rssForm"))
      $("#rssForm").elements.rssUrl.value = config.rssUrl || "";
    fillGoogleForms(config.googleForms);
    for (const slot of ["left", "right"]) {
      const url = slot === "left" ? config.joinImageLeft : config.joinImageRight;
      document.querySelector(`[data-join-preview="${slot}"]`).innerHTML = url
        ? `<img src="${h(url)}" alt="現在の写真">`
        : "<p>写真は未設定です。</p>";
    }
    $("#footerImagePreview").innerHTML = config.footerImageUrl
      ? `<img src="${h(config.footerImageUrl)}" alt="現在の写真">`
      : "<p>写真は未設定です。</p>";
    $("#aboutImagePreview").innerHTML = config.aboutImageUrl
      ? `<img src="${h(config.aboutImageUrl)}" alt="現在の写真">`
      : "<p>写真は未設定です。</p>";
    $("#introImagePreview").innerHTML = config.introImageUrl
      ? `<img src="${h(config.introImageUrl)}" alt="現在の写真">`
      : "<p>写真は未設定です。</p>";
  }
  // ===== 新歓：よくある質問（質問は候補リストから選べる。保存はサイト設定と同じフォーム） =====
  let faq = [];
  const faqParse = (text) => {
    const items = [];
    for (const raw of String(text || "").split(/\r?\n/)) {
      const mq = raw.match(/^\s*[QＱ][.．:：]\s*(.*)$/);
      const ma = raw.match(/^\s*[AＡ][.．:：]\s*(.*)$/);
      if (mq) items.push({ q: mq[1].trim(), a: [] });
      else if (ma && items.length) items[items.length - 1].a.push(ma[1]);
      else if (items.length && items[items.length - 1].a.length) items[items.length - 1].a.push(raw.trim());
    }
    return items.map((f) => ({ q: f.q, a: f.a.join("\n").trim() }));
  };
  const faqSync = () => {
    const t = document.querySelector('textarea[name="shinkanFaq"]');
    if (t)
      t.value = faq
        .filter((f) => f.q.trim() || f.a.trim())
        .map((f) => `Q. ${f.q.trim().replace(/\s*\n\s*/g, " ")}\nA. ${f.a.trim()}`)
        .join("\n\n");
  };
  function renderFaq() {
    const list = $("#faqList");
    if (!list) return;
    list.innerHTML = faq.length
      ? faq
          .map(
            (f, i) =>
              `<li class="faq-admin-item"><span class="qa-no">Q${i + 1}</span><label>質問<input list="faqSuggest" data-faqq="${i}" maxlength="100" value="${h(f.q)}" placeholder="クリックして候補から選ぶ／自由に入力"></label><label>回答<textarea data-faqa="${i}" maxlength="800" rows="3" placeholder="実際の内容で回答を書く">${h(f.a)}</textarea></label><div class="gallery-admin-buttons"><button class="btn small alt" type="button" data-faqmove="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""}>↑ 前へ</button><button class="btn small alt" type="button" data-faqmove="${i}" data-dir="1" ${i === faq.length - 1 ? "disabled" : ""}>↓ 後ろへ</button><button class="btn small danger" type="button" data-faqdel="${i}" aria-label="Q${i + 1}を削除">削除</button></div></li>`,
          )
          .join("")
      : '<li class="qa-empty">まだありません。「＋ 質問を追加」から入れてください。</li>';
    faqSync();
  }
  $("#faqList")?.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.faqq !== undefined) faq[+t.dataset.faqq].q = t.value;
    if (t.dataset.faqa !== undefined) faq[+t.dataset.faqa].a = t.value;
    faqSync();
  });
  $("#faqList")?.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.faqdel !== undefined) faq.splice(+b.dataset.faqdel, 1);
    else if (b.dataset.faqmove !== undefined) {
      const i = +b.dataset.faqmove,
        j = i + +b.dataset.dir;
      if (j < 0 || j >= faq.length) return;
      [faq[i], faq[j]] = [faq[j], faq[i]];
    } else return;
    renderFaq();
  });
  $("#addFaq")?.addEventListener("click", () => {
    faq.push({ q: "", a: "" });
    renderFaq();
    document.querySelector(`[data-faqq="${faq.length - 1}"]`)?.focus();
  });
  $("#settingsForm").addEventListener("submit", (e) => {
    e.preventDefault();
    // 新歓タブの「よくある質問を保存」も同じフォームで保存し、結果はそのボタンの近くに出す
    const status = e.submitter?.dataset.status || "#settingsStatus";
    action(
      e.submitter,
      async () => {
        const body = {
          ...Object.fromEntries(new FormData(e.target)),
          revision: config.revision,
        };
        const r = await api("/api/admin/settings", { method: "PUT", body });
        config = r.settings;
        message(
          status,
          "保存しました。公開ページの再読み込みで確認できます。",
        );
      },
      status,
    );
  });
  // ===== ギャラリー：追加・並べ替え・説明・削除 =====
  let gallery = [];
  function renderGallery() {
    $("#galleryList").innerHTML = gallery.length
      ? gallery
          .map(
            (g, i) =>
              `<li class="gallery-admin-item"><img src="${h(g.url)}" alt=""><div class="gallery-admin-fields"><span class="gallery-admin-no">${i + 1}枚目</span><label>写真の説明（読み上げ用・任意）<input data-alt="${i}" maxlength="80" value="${h(g.alt || "")}" placeholder="例：ビジコン本番のピッチ"></label><div class="gallery-admin-buttons"><button class="btn small alt" type="button" data-move="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""} aria-label="${i + 1}枚目を前へ">↑ 前へ</button><button class="btn small alt" type="button" data-move="${i}" data-dir="1" ${i === gallery.length - 1 ? "disabled" : ""} aria-label="${i + 1}枚目を後ろへ">↓ 後ろへ</button><button class="btn small danger" type="button" data-remove="${i}" aria-label="${i + 1}枚目を削除">削除</button></div></div></li>`,
          )
          .join("")
      : "<li class=\"gallery-admin-empty\">写真はまだありません。</li>";
  }
  async function loadGallery() {
    const s = await api("/api/admin/settings");
    gallery = Array.isArray(s.gallery) ? s.gallery.map((g) => ({ ...g })) : [];
    renderGallery();
  }
  $("#galleryList").addEventListener("input", (e) => {
    const i = e.target.dataset.alt;
    if (i !== undefined) gallery[Number(i)].alt = e.target.value;
  });
  $("#galleryList").addEventListener("click", (e) => {
    const mv = e.target.closest("[data-move]");
    const rm = e.target.closest("[data-remove]");
    if (mv) {
      const i = Number(mv.dataset.move),
        j = i + Number(mv.dataset.dir);
      [gallery[i], gallery[j]] = [gallery[j], gallery[i]];
      renderGallery();
    } else if (rm) {
      gallery.splice(Number(rm.dataset.remove), 1);
      renderGallery();
    }
  });
  $("#galleryFiles").addEventListener("change", (e) => {
    const input = e.target;
    const files = [...input.files];
    if (!files.length) return;
    action(
      input,
      async () => {
        const room = 12 - gallery.length;
        if (room <= 0) throw new Error("ギャラリーは12枚までです。");
        for (const [k, f] of files.slice(0, room).entries()) {
          message("#galleryStatus", `アップロード中… ${k + 1} / ${Math.min(files.length, room)}`);
          gallery.push({ url: await upload(f), alt: "" });
          renderGallery();
        }
        input.value = "";
        message(
          "#galleryStatus",
          files.length > room
            ? `12枚を超えた ${files.length - room} 枚は追加していません。「ギャラリーを保存」で公開されます。`
            : "追加しました。「ギャラリーを保存」で公開されます。",
        );
      },
      "#galleryStatus",
    );
  });
  $("#saveGallery").addEventListener("click", (e) =>
    action(
      e.currentTarget,
      async () => {
        await api("/api/admin/gallery", {
          method: "PUT",
          body: { photos: gallery.map((g) => ({ url: g.url, alt: g.alt || "" })) },
        });
        // サイト設定の版番号も進むので、設定フォームを読み直して食い違いを防ぐ
        await loadSettings();
        message("#galleryStatus", "保存しました。トップの再読み込みで確認できます。");
      },
      "#galleryStatus",
    ),
  );
  loadGallery().catch((e) => message("#galleryStatus", e.message, true));
  for (const form of document.querySelectorAll(".join-image-form")) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      action(
        e.submitter,
        async () => {
          const url = await upload(form.elements.file.files[0]);
          await api("/api/admin/join-image", {
            method: "PUT",
            body: { slot: form.dataset.slot, url },
          });
          form.reset();
          await loadSettings();
          message("#joinImageStatus", "写真を保存しました。");
        },
        "#joinImageStatus",
      );
    });
    form.querySelector("[data-join-remove]").addEventListener("click", (e) =>
      action(
        e.currentTarget,
        async () => {
          await api("/api/admin/join-image", {
            method: "PUT",
            body: { slot: form.dataset.slot, url: "" },
          });
          await loadSettings();
          message("#joinImageStatus", "写真を外しました。");
        },
        "#joinImageStatus",
      ),
    );
  }
  $("#footerImageForm").addEventListener("submit", (e) => {
    e.preventDefault();
    action(
      e.submitter,
      async () => {
        const url = await upload(e.target.elements.file.files[0]);
        await api("/api/admin/footer-image", { method: "PUT", body: { url } });
        e.target.reset();
        await loadSettings();
        message("#footerImageStatus", "写真を保存しました。");
      },
      "#footerImageStatus",
    );
  });
  $("#footerImageRemove").addEventListener("click", (e) =>
    action(
      e.currentTarget,
      async () => {
        await api("/api/admin/footer-image", { method: "PUT", body: { url: "" } });
        await loadSettings();
        message("#footerImageStatus", "写真を外しました。");
      },
      "#footerImageStatus",
    ),
  );
  $("#aboutImageForm").addEventListener("submit", (e) => {
    e.preventDefault();
    action(
      e.submitter,
      async () => {
        const url = await upload(e.target.elements.file.files[0]);
        await api("/api/admin/about-image", { method: "PUT", body: { url } });
        e.target.reset();
        await loadSettings();
        message("#aboutImageStatus", "写真を保存しました。");
      },
      "#aboutImageStatus",
    );
  });
  $("#aboutImageRemove").addEventListener("click", (e) =>
    action(
      e.currentTarget,
      async () => {
        await api("/api/admin/about-image", { method: "PUT", body: { url: "" } });
        await loadSettings();
        message("#aboutImageStatus", "写真を外しました。");
      },
      "#aboutImageStatus",
    ),
  );
  $("#introImageForm").addEventListener("submit", (e) => {
    e.preventDefault();
    action(
      e.submitter,
      async () => {
        const url = await upload(e.target.elements.file.files[0]);
        await api("/api/admin/intro-image", { method: "PUT", body: { url } });
        e.target.reset();
        await loadSettings();
        message("#introImageStatus", "写真を保存しました。");
      },
      "#introImageStatus",
    );
  });
  $("#introImageRemove").addEventListener("click", (e) =>
    action(
      e.currentTarget,
      async () => {
        await api("/api/admin/intro-image", { method: "PUT", body: { url: "" } });
        await loadSettings();
        message("#introImageStatus", "写真を外しました。");
      },
      "#introImageStatus",
    ),
  );
  // ===== 新歓ページのメンバー紹介：追加・写真・吹き出し・タグ・並べ替え・削除 =====
  let members = [];
  function renderMembers() {
    $("#memberList").innerHTML = members.length
      ? members
          .map(
            (m, i) =>
              `<li class="member-admin-item">${m.url ? `<img src="${h(m.url)}" alt="">` : '<span class="member-admin-noimg">写真なし</span>'}<div class="gallery-admin-fields"><span class="gallery-admin-no">${i + 1}人目</span><label>写真（JPEG/PNG/WebP・8MB以内）<input type="file" accept="image/jpeg,image/png,image/webp" data-photo="${i}"></label><label>吹き出し：入った理由など（60文字まで）<input data-bubble="${i}" maxlength="60" value="${h(m.bubble || "")}" placeholder="例：ビジコンに挑戦したくて！"></label><label>タグ（カンマ区切り・5つまで。# は自動で付きます）<input data-tags="${i}" maxlength="120" value="${h((m.tags || []).join(", "))}" placeholder="例：経営学科, 映画鑑賞, サウナ"></label><fieldset class="qa-edit"><legend>Q&amp;A（カードを押すと裏返って表示・6つまで）</legend>${(m.qa || []).length ? "" : '<p class="qa-empty">まだありません。「＋ 質問を追加」から入れてください。</p>'}${(m.qa || []).map((x, k) => `<div class="qa-row"><span class="qa-no">Q${k + 1}</span><label>質問<input list="qaSuggest" data-qaq="${i}-${k}" maxlength="40" value="${h(x.q || "")}" placeholder="例：好きな授業は？"></label><label>答え<input data-qaa="${i}-${k}" maxlength="120" value="${h(x.a || "")}" placeholder="例：マーケティング論"></label><button class="btn small danger" type="button" data-qadel="${i}-${k}" aria-label="Q${k + 1}を削除">削除</button></div>`).join("")}${(m.qa || []).length < 6 ? `<button class="btn small alt" type="button" data-qaadd="${i}">＋ 質問を追加</button>` : ""}</fieldset><div class="gallery-admin-buttons"><button class="btn small alt" type="button" data-mmove="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""}>↑ 前へ</button><button class="btn small alt" type="button" data-mmove="${i}" data-dir="1" ${i === members.length - 1 ? "disabled" : ""}>↓ 後ろへ</button><button class="btn small danger" type="button" data-mremove="${i}">削除</button></div></div></li>`,
          )
          .join("")
      : '<li class="gallery-admin-empty">メンバーはまだいません。</li>';
  }
  async function loadMembers() {
    const s = await api("/api/admin/settings");
    members = Array.isArray(s.shinkanMembers)
      ? s.shinkanMembers.map((m) => ({ url: m.url || "", bubble: m.bubble || "", tags: [...(m.tags || [])], qa: (m.qa || []).map((x) => ({ ...x })) }))
      : [];
    renderMembers();
  }
  const splitTags = (v) =>
    v
      .split(/[,、，]/)
      .map((t) => t.replace(/^[#＃\s]+/, "").trim())
      .filter(Boolean)
      .slice(0, 5);
  $("#memberList").addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.bubble !== undefined) members[Number(t.dataset.bubble)].bubble = t.value;
    if (t.dataset.tags !== undefined) members[Number(t.dataset.tags)].tags = splitTags(t.value);
    if (t.dataset.qaq !== undefined || t.dataset.qaa !== undefined) {
      const [mi, k] = (t.dataset.qaq || t.dataset.qaa).split("-").map(Number);
      const row = members[mi].qa[k];
      if (t.dataset.qaq !== undefined) row.q = t.value;
      else row.a = t.value;
    }
  });
  $("#memberList").addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.photo === undefined || !t.files[0]) return;
    const i = Number(t.dataset.photo);
    action(
      t,
      async () => {
        message("#membersStatus", "写真をアップロード中…");
        members[i].url = await upload(t.files[0]);
        renderMembers();
        message("#membersStatus", "写真を追加しました。「メンバー紹介を保存」で公開されます。");
      },
      "#membersStatus",
    );
  });
  $("#memberList").addEventListener("click", (e) => {
    const add = e.target.closest("[data-qaadd]");
    const del = e.target.closest("[data-qadel]");
    if (add) {
      const i = Number(add.dataset.qaadd);
      members[i].qa = members[i].qa || [];
      if (members[i].qa.length < 6) members[i].qa.push({ q: "", a: "" });
      renderMembers();
      document.querySelector(`[data-qaq="${i}-${members[i].qa.length - 1}"]`)?.focus();
      return;
    }
    if (del) {
      const [i, k] = del.dataset.qadel.split("-").map(Number);
      members[i].qa.splice(k, 1);
      renderMembers();
      return;
    }
    const mv = e.target.closest("[data-mmove]");
    const rm = e.target.closest("[data-mremove]");
    if (mv) {
      const i = Number(mv.dataset.mmove),
        j = i + Number(mv.dataset.dir);
      [members[i], members[j]] = [members[j], members[i]];
      renderMembers();
    } else if (rm) {
      members.splice(Number(rm.dataset.mremove), 1);
      renderMembers();
    }
  });
  $("#addMember").addEventListener("click", () => {
    if (members.length >= 30)
      return message("#membersStatus", "メンバー紹介は30人までです。", true);
    members.push({ url: "", bubble: "", tags: [], qa: [] });
    renderMembers();
  });
  $("#saveMembers").addEventListener("click", (e) =>
    action(
      e.currentTarget,
      async () => {
        await api("/api/admin/shinkan-members", {
          method: "PUT",
          body: {
            members: members.map((m) => ({
              url: m.url || "",
              bubble: (m.bubble || "").trim(),
              tags: (m.tags || []).map((t) => t.slice(0, 20)),
              qa: (m.qa || [])
                .map((x) => ({ q: (x.q || "").trim().slice(0, 40), a: (x.a || "").trim().slice(0, 120) }))
                .filter((x) => x.q && x.a),
            })),
          },
        });
        await loadSettings();
        message("#membersStatus", "保存しました。新歓ページの再読み込みで確認できます。");
      },
      "#membersStatus",
    ),
  );
  loadMembers().catch((e) => message("#membersStatus", e.message, true));
  $("#logoForm").addEventListener("submit", (e) => {
    e.preventDefault();
    action(
      e.submitter,
      async () => {
        const url = await upload(e.target.elements.file.files[0]);
        await api("/api/admin/logo", { method: "PUT", body: { url } });
        await loadSettings();
        message("#logoStatus", "ロゴを保存しました。");
      },
      "#logoStatus",
    );
  });
  async function loadArticles() {
    const p = new URLSearchParams({
      page: articlePage,
      q: $("#adminQuery").value,
      unclassified: String($("#unclassified").checked),
    });
    const r = await api("/api/admin/articles?" + p);
    articles = r.items;
    $("#adminArticles").innerHTML = r.items.length
      ? r.items
          .map(
            (a) =>
              `<tr><td><b>${h(a.title)}</b><br><time>${h(new Date(a.publishedAt).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }))}</time></td><td>${h([a.type || "未分類", a.type === "インタビュー" ? a.industry || "業界未分類" : a.type === "活動記録" ? a.activityKind || "コンテンツ未分類" : ""].filter(Boolean).join(" / "))}<br>${h(a.manualTags ? "手動設定" : a.classificationStatus === "review" ? "AI推定・要確認" : a.classificationStatus === "failed" ? "AI推定失敗" : "推定待ち")}</td><td><span class="toggle ${a.visible ? "" : "off"}">${a.visible ? "公開" : "非表示"}</span></td><td><button class="btn small alt" type="button" data-edit="${h(a.id)}">編集</button></td></tr>`,
          )
          .join("")
      : '<tr><td colspan="4">登録記事がありません。</td></tr>';
    $("#adminPagination").innerHTML =
      `<button class="btn small alt" data-page="${r.page - 1}" ${r.page === 1 ? "disabled" : ""}>前へ</button><span>${r.page} / ${r.pages}（${r.total}件）</span><button class="btn small alt" data-page="${r.page + 1}" ${r.page === r.pages ? "disabled" : ""}>次へ</button>`;
  }
  $("#reloadArticles").addEventListener("click", () =>
    action($("#reloadArticles"), async () => {
      articlePage = 1;
      await loadArticles();
    }),
  );
  $("#adminPagination").addEventListener("click", (e) => {
    const b = e.target.closest("[data-page]");
    if (b)
      action(b, async () => {
        articlePage = Number(b.dataset.page);
        await loadArticles();
      });
  });
  // 業界はインタビュー、コンテンツは活動記録のときだけ表示する
  function syncArticleType() {
    const f = $("#articleForm");
    for (const label of f.querySelectorAll("[data-for-type]"))
      label.hidden = label.dataset.forType !== f.elements.type.value;
  }
  $("#articleForm").elements.type.addEventListener("change", syncArticleType);
  function editArticle(a) {
    editing = a || null;
    const f = $("#articleForm");
    f.reset();
    for (const key of [
      "title",
      "lead",
      "noteUrl",
      "type",
      "industry",
      "activityKind",
      "imageUrl",
    ])
      f.elements[key].value = a?.[key] || "";
    syncArticleType();
    const d = a ? new Date(a.publishedAt) : new Date();
    const pad = (n) => String(n).padStart(2, "0");
    f.elements.date.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    f.elements.visible.checked = a ? a.visible : false;
    $("#articleDialogTitle").textContent = a ? "記事を編集" : "記事を登録";
    $("#articleStatus").textContent = "";
    $("#articleDialog").showModal();
  }
  $("#newArticle").addEventListener("click", () => editArticle(null));
  $("#adminArticles").addEventListener("click", (e) => {
    const b = e.target.closest("[data-edit]");
    if (b) editArticle(articles.find((a) => a.id === b.dataset.edit));
  });
  $("#cancelArticle").addEventListener("click", () =>
    $("#articleDialog").close(),
  );
  $("#articleForm").addEventListener("submit", (e) => {
    e.preventDefault();
    action(
      e.submitter,
      async () => {
        const f = e.target;
        const v = Object.fromEntries(new FormData(f));
        const body = {
          title: v.title,
          lead: v.lead,
          noteUrl: v.noteUrl,
          publishedAt: new Date(v.date).toISOString(),
          type: v.type || null,
          industry: v.type === "インタビュー" ? v.industry || null : null,
          activityKind: v.type === "活動記録" ? v.activityKind || null : null,
          imageUrl: v.imageUrl,
          visible: f.elements.visible.checked,
        };
        if (f.elements.file.files[0])
          body.imageUrl = await upload(f.elements.file.files[0]);
        if (editing) body.revision = editing.revision;
        await api("/api/admin/articles" + (editing ? "/" + editing.id : ""), {
          method: editing ? "PUT" : "POST",
          body,
        });
        $("#articleDialog").close();
        await Promise.all([loadArticles(), loadMetrics()]);
        message("#globalStatus", "記事を保存しました。");
      },
      "#articleStatus",
    );
  });
  $("#syncRss").addEventListener("click", () =>
    action($("#syncRss"), async () => {
      message("#globalStatus", "RSS取得中…");
      const r = await api("/api/admin/rss/sync", { method: "POST", body: {} });
      message(
        "#globalStatus",
        r.notConfigured
          ? "RSS URLが未設定です。管理者が設定してください。"
          : r.busy
            ? "ほかの取得処理が実行中です。"
            : `取得完了：新規${r.inserted}件・登録済み${r.skipped}件・失敗${r.failed}件`,
      );
      await Promise.all([loadArticles(), loadMetrics(), loadOperations()]);
    }),
  );
  $("#importNotes").addEventListener("click", () =>
    action(
      $("#importNotes"),
      async () => {
        const urls = [
          ...new Set(
            $("#importUrls").value.match(
              /https:\/\/note\.com\/[^\s,"'<>]+\/n\/n[a-zA-Z0-9]+/g,
            ) || [],
          ),
        ];
        if (!urls.length) throw new Error("note記事URLを入力してください。");
        const results = [];
        for (let i = 0; i < urls.length; i += 5) {
          message("#importStatus", `${i} / ${urls.length}件を処理中…`);
          const r = await api("/api/admin/import", {
            method: "POST",
            body: { urls: urls.slice(i, i + 5) },
          });
          results.push(...r.results);
        }
        message(
          "#importStatus",
          results
            .map(
              (r) =>
                r.url +
                " " +
                (r.error || (r.duplicate ? "登録済み" : "登録しました")),
            )
            .join("\n"),
        );
        await Promise.all([loadArticles(), loadMetrics()]);
      },
      "#importStatus",
    ),
  );
  $("#enrichArticles").addEventListener("click", () =>
    action($("#enrichArticles"), async () => {
      message("#globalStatus", "AI・画像処理中…");
      const r = await api("/api/admin/rss/enrich", {
        method: "POST",
        body: {},
      });
      message(
        "#globalStatus",
        r.configured === false
          ? "AI・画像APIが未設定です。"
          : r.busy
            ? "他の処理が実行中です。"
            : `${r.processed}件を処理しました。未分類は人による確認が必要です。`,
      );
      await Promise.all([loadArticles(), loadMetrics()]);
    }),
  );
  let slideValues = [];
  // 開いているスライドを覚えておき、描き直しても閉じないようにする
  const openSlides = new Set();
  $("#slideEditors").addEventListener(
    "toggle",
    (e) => {
      const ed = e.target.closest?.(".slide-editor");
      if (!ed || !e.target.matches("details")) return;
      const i = Number(ed.dataset.index);
      if (e.target.open) openSlides.add(i);
      else openSlides.delete(i);
    },
    true,
  );
  function renderSlides() {
    const target = $("#slideEditors");
    target.innerHTML = "";
    slideValues.forEach((s, i) => {
      const div = document.createElement("div");
      div.className = "slide-editor";
      div.dataset.index = i;
      const isOpen = openSlides.has(i) || !s.id;
      div.innerHTML = `<details class="fold" ${isOpen ? "open" : ""}><summary>${s.imageUrl ? `<img class="fold-thumb" src="${h(s.imageUrl)}" alt="">` : '<span class="fold-thumb"></span>'}<span class="fold-title">${i + 1}枚目　${h(s.label || "（タイトルなし）")}</span><span class="fold-state ${s.visible ? "on" : ""}">${s.visible ? "公開中" : "非公開"}</span></summary><div class="admin-form-grid"><h3 class="wide">${i + 1}枚目</h3>${s.imageUrl ? `<img class="slide-preview" src="${h(s.imageUrl)}" alt="写真プレビュー">` : ""}<label class="wide">写真URL<input name="imageUrl" value="${h(s.imageUrl || "")}" placeholder="HTTPS画像URLまたはアップロード済みパス"></label><label>写真をアップロード<input name="file" type="file" accept="image/jpeg,image/png,image/webp"></label><label class="wide">タイトル（3行を超えると「…」で省略）<input name="label" maxlength="160" value="${h(s.label || "")}"></label><fieldset class="wide slide-text-fields"><legend>左側の文章（すべて空欄なら写真だけを表示）</legend><label>番号（空欄で自動：01, 02…）<input name="numberLabel" maxlength="10" value="${h(s.numberLabel || "")}" placeholder="例：09"></label><label>日付<input name="dateLabel" maxlength="20" value="${h(s.dateLabel || "")}" placeholder="例：2026.10"></label><label>カテゴリ<input name="category" maxlength="30" value="${h(s.category || "")}" placeholder="例：経営者インタビュー"></label><label class="wide">所属・名前（大きめの太字で表示）<input name="author" maxlength="100" value="${h(s.author || "")}" placeholder="例：株式会社〇〇 代表取締役 山田 太郎"></label><label class="wide">詳細（所属・名前の下に表示。2行を超えると「…」で省略）<textarea name="detail" maxlength="300" rows="3" placeholder="例：2010年創業。学生向けキャリア支援サービスを展開">${h(s.detail || "")}</textarea></label><label class="wide">タグ（カンマ区切り・5つまで）<input name="tags" maxlength="400" value="${h((s.tags || "").split(",").filter(Boolean).join(", "))}" placeholder="例：IT・SaaS, インターン, 就活"></label></fieldset><label class="wide">リンク先（写真を押したときに開くページ。空欄ならリンクなし）<input name="linkUrl" value="${h(s.linkUrl || "")}" placeholder="例：https://note.com/... または /interviews"></label><p class="wide admin-hint">note記事などサイト外のURLは新しいタブで開きます。サイト内のページは「/about」のように / から入力します。</p><label class="check-label"><input name="visible" type="checkbox" ${s.visible ? "checked" : ""}>公開する</label></div></details>`;
      target.append(div);
    });
  }
  // 写真を選んだらその場でアップロードし、URL欄とプレビューに反映する。
  // （「写真を追加」で一覧を描き直しても選んだ写真が消えないようにするため）
  $("#slideEditors").addEventListener("change", async (e) => {
    if (e.target.name !== "file" || !e.target.files.length) return;
    const index = Number(e.target.closest(".slide-editor").dataset.index);
    const input = e.target;
    input.disabled = true;
    message("#slidesStatus", "写真をアップロードしています…");
    try {
      const url = await upload(input.files[0]);
      // アップロード中に一覧が描き直されても、同じ番号の枠に反映する
      if (slideValues[index])
        Object.assign(slideValues[index], { imageUrl: url, visible: true });
      const editor = $("#slideEditors").children[index];
      if (editor) {
        editor.querySelector("[name=imageUrl]").value = url;
        editor.querySelector("[name=visible]").checked = true;
        let img = editor.querySelector(".slide-preview");
        if (!img) {
          img = document.createElement("img");
          img.className = "slide-preview";
          img.alt = "写真プレビュー";
          editor.querySelector("h3").after(img);
        }
        img.src = url;
        editor.querySelector("[name=file]").value = "";
      }
      message(
        "#slidesStatus",
        "写真をアップロードしました。「写真設定を保存」で公開されます。",
      );
    } catch (err) {
      message("#slidesStatus", err.message, true);
    } finally {
      input.disabled = false;
    }
  });
  async function loadSlides() {
    slideValues = await api("/api/admin/slides");
    renderSlides();
  }
  function captureSlides() {
    return [...$("#slideEditors").children].map((el, i) => ({
      ...slideValues[i],
      imageUrl: el.querySelector("[name=imageUrl]").value,
      label: el.querySelector("[name=label]").value,
      numberLabel: el.querySelector("[name=numberLabel]").value,
      dateLabel: el.querySelector("[name=dateLabel]").value,
      category: el.querySelector("[name=category]").value,
      author: el.querySelector("[name=author]").value,
      detail: el.querySelector("[name=detail]").value,
      tags: el.querySelector("[name=tags]").value,
      linkUrl: el.querySelector("[name=linkUrl]").value,
      visible: el.querySelector("[name=visible]").checked,
    }));
  }
  $("#addSlide").addEventListener("click", () => {
    if (slideValues.length >= 5)
      return message("#slidesStatus", "スライドは5枚までです。", true);
    slideValues = captureSlides();
    slideValues.push({
      imageUrl: "",
      label: "",
      linkUrl: "",
      numberLabel: "",
      dateLabel: "",
      category: "",
      author: "",
      detail: "",
      tags: "",
      visible: true,
    });
    renderSlides();
  });
  $("#slidesForm").addEventListener("submit", (e) => {
    e.preventDefault();
    action(
      e.submitter,
      async () => {
        const values = captureSlides();
        for (let i = 0; i < values.length; i++) {
          const file =
            $("#slideEditors").children[i].querySelector("[name=file]")
              .files[0];
          if (file) values[i].imageUrl = await upload(file);
        }
        const body = values.map((s) => ({
          ...(s.id ? { id: s.id, revision: s.revision } : {}),
          imageUrl: s.imageUrl,
          label: s.label,
          linkUrl: s.linkUrl,
          numberLabel: s.numberLabel || "",
          dateLabel: s.dateLabel || "",
          category: s.category || "",
          author: s.author || "",
          detail: s.detail || "",
          tags: s.tags || "",
          visible: Boolean(s.visible),
        }));
        await api("/api/admin/slides", { method: "PUT", body });
        await loadSlides();
        const shown = body.filter((x) => x.visible).length;
        message(
          "#slidesStatus",
          `写真設定を保存しました。公開中：${shown}枚` +
            (shown < 2
              ? "（スライドショーは公開中の写真が2枚以上で動きます）"
              : ""),
        );
      },
      "#slidesStatus",
    );
  });
  async function loadMetrics() {
    const r = await api("/api/admin/metrics");
    $("#metricTotal").textContent = r.totals.total || 0;
    $("#metricPublic").textContent = r.totals.published || 0;
    $("#metricPending").textContent = r.totals.unclassified || 0;
    const month = new Date().toISOString().slice(0, 7);
    $("#metricClicks").textContent =
      r.monthly.find((m) => m.month === month)?.clicks || 0;
    $("#monthlyMetrics").innerHTML = r.monthly.length
      ? r.monthly
          .map(
            (m) =>
              `<tr><td>${h(m.month)}</td><td>${h(m.views)}</td><td>${h(m.clicks)}</td></tr>`,
          )
          .join("")
      : '<tr><td colspan="3">まだ記録がありません。</td></tr>';
    $("#pageMetrics").innerHTML =
      r.pages.map((m) => `<p>${h(m.target)}：${h(m.count)}</p>`).join("") ||
      "<p>記録なし</p>";
    $("#clickMetrics").innerHTML =
      r.clicks
        .map((m) => `<p>${h(m.title || m.target)}：${h(m.count)}</p>`)
        .join("") || "<p>記録なし</p>";
  }
  $("#reloadMetrics").addEventListener("click", () =>
    action($("#reloadMetrics"), loadMetrics),
  );
  async function loadOperations() {
    if (!$("#operationStatus")) return;
    const r = await api("/api/admin/status");
    $("#operationStatus").textContent =
      `フォーム受付：Googleフォーム（通知・回答管理はGoogle側）\nGoogleログイン：${r.loginConfigured ? "設定済み" : "未設定"}\nAIタグ付け：${r.aiConfigured ? "設定済み" : "未設定（手動でタグ付け）"}\n定期ジョブの鍵：${r.cronConfigured ? "設定済み" : "未設定"}\n初期管理者設定：${r.bootstrapConfigured ? "あり" : "未設定"}\n` +
      r.states.map((s) => `${s.name}：${JSON.stringify(s.data)}`).join("\n") +
      "\n定期ジョブ：" +
      (r.jobs.length
        ? r.jobs
            .map((j) => `${j.kind} ${j.taskUid} ${j.lastStatus || "未実行"}`)
            .join("\n")
        : "未登録");
  }
  if ($("#rssForm"))
    $("#rssForm").addEventListener("submit", (e) => {
      e.preventDefault();
      action(e.submitter, async () => {
        await api("/api/admin/rss", {
          method: "PUT",
          body: { url: e.target.elements.rssUrl.value },
        });
        await loadSettings();
        message("#globalStatus", "RSS URLを保存しました。");
      });
    });
  $("#runMaintenance")?.addEventListener("click", () =>
    action($("#runMaintenance"), async () => {
      const r = await api("/api/admin/maintenance", {
        method: "POST",
        body: {},
      });
      message(
        "#globalStatus",
        `保存期限を過ぎた${r.deleted}件を削除しました。`,
      );
      await loadOperations();
    }),
  );
  async function loadUsers() {
    if (!$("#userList")) return;
    const r = await api("/api/admin/users");
    const roleLabel = (u) =>
      u.role === "admin"
        ? "管理者"
        : u.role === "editor" && u.active
          ? "編集者"
          : u.active
            ? "権限なし"
            : "解除済み";
    $("#userList").innerHTML = r.users
      .map((u) => {
        const editing = u.role === "editor" && u.active;
        const removable = u.role !== "admin" && !editing;
        return `<p class="user-row"><span>${h(u.name || "名称未設定")} / ${roleLabel(u)}</span>${editing ? `<button class="btn small alt" data-remove-user="${h(u.openId)}">権限を解除</button>` : ""}${removable ? `<button class="btn small danger" data-delete-user="${h(u.openId)}" data-name="${h(u.name || "名称未設定")}">リストから削除</button>` : ""}</p>`;
      })
      .join("");
    $("#inviteList").innerHTML = r.invites
      .map(
        (i) =>
          `<p>ログイン待ちの編集者 / ${h(new Date(i.createdAt).toLocaleDateString("ja-JP"))} <button class="btn small alt" data-remove-invite="${h(i.id)}">追加を取り消す</button></p>`,
      )
      .join("");
  }
  $("#inviteForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    action(e.submitter, async () => {
      await api("/api/admin/users", {
        method: "POST",
        body: { email: e.target.elements.email.value },
      });
      e.target.reset();
      await loadUsers();
      message(
        "#globalStatus",
        "編集者を追加しました。同じメールのGoogleアカウントでログインしてください。",
      );
    });
  });
  $("#userList")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-remove-user]");
    if (b)
      action(b, async () => {
        await api(
          "/api/admin/users/" + encodeURIComponent(b.dataset.removeUser),
          { method: "DELETE" },
        );
        await loadUsers();
      });
    const d = e.target.closest("[data-delete-user]");
    if (
      d &&
      confirm(
        `${d.dataset.name} さんをリストから削除しますか？\n（もう一度ログインすると「権限なし」として再び表示されます）`,
      )
    )
      action(d, async () => {
        await api(
          "/api/admin/users/" +
            encodeURIComponent(d.dataset.deleteUser) +
            "/record",
          { method: "DELETE" },
        );
        await loadUsers();
        message("#globalStatus", "リストから削除しました。");
      });
  });
  $("#inviteList")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-remove-invite]");
    if (b)
      action(b, async () => {
        await api("/api/admin/invites/" + b.dataset.removeInvite, {
          method: "DELETE",
        });
        await loadUsers();
      });
  });
  (async () => {
    try {
      await Promise.all([
        loadSettings(),
        loadArticles(),
        loadSlides(),
        loadMetrics(),
        loadOperations(),
        loadUsers(),
      ]);
    } catch (e) {
      message("#globalStatus", e.message, true);
    }
  })();

  const GOOGLE_SLOTS = ["inquiry", "interview", "sponsor", "recruitment"];
  function fillGoogleForms(forms = {}) {
    const f = $("#googleFormsForm");
    for (const key of GOOGLE_SLOTS) {
      f.elements[key + "Url"].value = forms[key]?.url || "";
      f.elements[key + "Height"].value = forms[key]?.height || 1000;
      const state = document.querySelector(`[data-form-state="${key}"]`);
      if (state) {
        state.textContent = forms[key]?.url ? "設定済み" : "未設定";
        state.classList.toggle("on", Boolean(forms[key]?.url));
      }
    }
  }
  $("#googleFormsForm").addEventListener("submit", (e) => {
    e.preventDefault();
    action(
      e.submitter,
      async () => {
        const f = e.target;
        const forms = Object.fromEntries(
          GOOGLE_SLOTS.map((key) => [
            key,
            {
              url: f.elements[key + "Url"].value.trim(),
              height: Number(f.elements[key + "Height"].value),
            },
          ]),
        );
        const result = await api("/api/admin/forms", {
          method: "PUT",
          body: { revision: config.revision, forms },
        });
        config = result.settings;
        fillGoogleForms(config.googleForms);
        message(
          "#googleFormsStatus",
          "保存しました。公開ページを再読み込みすると反映されます。",
        );
      },
      "#googleFormsStatus",
    );
  });
  $("#googleFormsForm").addEventListener("click", (e) => {
    const b = e.target.closest("[data-form-preview]");
    if (!b) return;
    action(
      b,
      async () => {
        const f = $("#googleFormsForm"),
          key = b.dataset.formPreview;
        const v = await api("/api/admin/forms/preview", {
          method: "POST",
          body: {
            url: f.elements[key + "Url"].value.trim(),
            height: Number(f.elements[key + "Height"].value),
          },
        });
        if (!v.url) throw new Error("フォームURLを入力してください。");
        const target = $("#googleFormPreviewContent");
        target.replaceChildren();
        const link = document.createElement("a");
        link.className = "text-link";
        link.href = v.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "別のタブで開く ↗";
        target.append(link);
        if (v.embedUrl) {
          const frame = document.createElement("iframe");
          frame.src = v.embedUrl;
          frame.title = "Googleフォームのプレビュー";
          frame.className = "google-form-frame";
          frame.height = String(v.height);
          frame.referrerPolicy = "strict-origin-when-cross-origin";
          target.append(frame);
        } else {
          const p = document.createElement("p");
          p.textContent = "短縮URLは外部リンクで表示します。";
          target.append(p);
        }
        $("#googleFormPreview").showModal();
      },
      "#googleFormsStatus",
    );
  });
  $("#closeGoogleFormPreview").addEventListener("click", () => {
    $("#googleFormPreview").close();
    $("#googleFormPreviewContent").replaceChildren();
  });
})();
