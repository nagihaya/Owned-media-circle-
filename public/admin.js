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
  async function action(button, fn, target = "#globalStatus") {
    button.disabled = true;
    try {
      await fn();
    } catch (e) {
      message(target, e.message, true);
    } finally {
      button.disabled = false;
    }
  }
  async function upload(file) {
    const form = new FormData();
    form.append("file", file);
    return (await api("/api/admin/upload", { method: "POST", body: form })).url;
  }
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
      "response",
      "contact",
      "policyDate",
    ])
      f.elements[name].value = config[name] || "";
    if ($("#rssForm"))
      $("#rssForm").elements.rssUrl.value = config.rssUrl || "";
    fillGoogleForms(config.googleForms);
  }
  $("#settingsForm").addEventListener("submit", (e) => {
    e.preventDefault();
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
          "#settingsStatus",
          "保存しました。公開ページの再読み込みで確認できます。",
        );
      },
      "#settingsStatus",
    );
  });
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
              `<tr><td><b>${h(a.title)}</b><br><time>${h(new Date(a.publishedAt).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }))}</time></td><td>${h([a.industry, a.size, a.type].map((v) => v || "未分類").join(" / "))}<br>${h(a.manualTags ? "手動設定" : a.classificationStatus === "review" ? "AI推定・要確認" : a.classificationStatus === "failed" ? "AI推定失敗" : "推定待ち")}</td><td><span class="toggle ${a.visible ? "" : "off"}">${a.visible ? "公開" : "非表示"}</span></td><td><button class="btn small alt" type="button" data-edit="${h(a.id)}">編集</button></td></tr>`,
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
  function editArticle(a) {
    editing = a || null;
    const f = $("#articleForm");
    f.reset();
    for (const key of [
      "title",
      "lead",
      "noteUrl",
      "industry",
      "size",
      "type",
      "imageUrl",
    ])
      f.elements[key].value = a?.[key] || "";
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
          industry: v.industry || null,
          size: v.size || null,
          type: v.type || null,
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
  function renderSlides() {
    const target = $("#slideEditors");
    target.innerHTML = "";
    slideValues.forEach((s, i) => {
      const div = document.createElement("div");
      div.className = "slide-editor admin-form-grid";
      div.dataset.index = i;
      div.innerHTML = `<h3 class="wide">${i + 1}枚目</h3>${s.imageUrl ? `<img class="slide-preview" src="${h(s.imageUrl)}" alt="写真プレビュー">` : ""}<label class="wide">写真URL<input name="imageUrl" value="${h(s.imageUrl || "")}" placeholder="HTTPS画像URLまたはアップロード済みパス"></label><label>写真をアップロード<input name="file" type="file" accept="image/jpeg,image/png,image/webp"></label><label>表示名<input name="label" maxlength="80" value="${h(s.label || "")}"></label><label class="wide">リンク先<input name="linkUrl" value="${h(s.linkUrl || "")}" placeholder="/articles またはHTTPS URL"></label><label class="check-label"><input name="visible" type="checkbox" ${s.visible ? "checked" : ""}>公開する</label>`;
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
      linkUrl: el.querySelector("[name=linkUrl]").value,
      visible: el.querySelector("[name=visible]").checked,
    }));
  }
  $("#addSlide").addEventListener("click", () => {
    if (slideValues.length >= 5)
      return message("#slidesStatus", "スライドは5枚までです。", true);
    slideValues = captureSlides();
    slideValues.push({ imageUrl: "", label: "", linkUrl: "", visible: true });
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
    $("#userList").innerHTML = r.users
      .map(
        (u) =>
          `<p>${h(u.name || "名称未設定")} / ${h(u.role)} / ${u.active ? "有効" : "無効"} ${u.role !== "admin" && u.active ? `<button class="btn small alt" data-remove-user="${h(u.openId)}">権限を解除</button>` : ""}</p>`,
      )
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
