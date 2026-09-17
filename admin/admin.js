(() => {
  "use strict";

  const api = window.BlogApi;
  const page = document.body.dataset.page;
  const message = document.querySelector("#message");
  const errorMessages = {
    NETWORK_ERROR: "无法连接博客服务，请检查网络后重试。",
    INVALID_CREDENTIALS: "管理员密码不正确。",
    UNAUTHORIZED: "登录已过期，请重新登录。",
    RATE_LIMITED: "操作太频繁，请稍后再试。",
    GITHUB_UNAVAILABLE: "暂时无法连接 GitHub，请稍后再试。",
    GITHUB_API_ERROR: "GitHub 拒绝了这次操作，请检查 Token 权限。",
    GITHUB_CONFLICT: "文章已在其他地方发生变化，请刷新后重试。",
    POST_EXISTS: "这个文章链接已经存在，请换一个。",
    POST_NOT_FOUND: "没有找到这篇文章。",
    INVALID_TITLE: "请填写标题，且不要超过 180 个字符。",
    INVALID_DESCRIPTION: "文章摘要不能超过 500 个字符。",
    INVALID_DATE: "请选择有效的发布日期。",
    INVALID_COVER_URL: "封面图片地址必须是有效的 HTTPS 地址。",
    INVALID_LOCATION: "地点不能超过 120 个字符。",
    INVALID_SLUG: "文章链接只能包含英文字母、数字和连字符。",
    SLUG_IMMUTABLE: "文章发布后不能修改链接。",
    MARKDOWN_TOO_LARGE: "正文超过 512 KiB 限制。",
    IMAGE_TOO_LARGE: "图片不能超过 8 MiB。",
    UNSUPPORTED_IMAGE_TYPE: "只支持 JPEG、PNG、WebP 和 GIF 图片。",
    IMAGE_TYPE_MISMATCH: "图片内容与文件类型不一致。",
    EMPTY_IMAGE: "请选择一个非空图片文件。",
    R2_UPLOAD_ERROR: "图片上传失败，请稍后重试。",
  };

  function showMessage(text, type = "error") {
    if (!message) return;
    message.textContent = text;
    message.className = `notice ${type}`;
    message.hidden = false;
    message.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function clearMessage() {
    if (message) message.hidden = true;
  }

  function handleError(error) {
    if (error?.status === 401 && page !== "login") {
      location.replace("/admin/login.html");
      return;
    }
    showMessage(errorMessages[error?.code] || error?.message || "操作失败，请稍后重试。");
  }

  async function requireSession() {
    try {
      await api.me();
      return true;
    } catch (error) {
      if (error?.status === 401) {
        location.replace("/admin/login.html");
        return false;
      }
      handleError(error);
      return false;
    }
  }

  function attachLogout() {
    document.querySelector("#logout")?.addEventListener("click", async () => {
      try { await api.logout(); } catch { /* The local cookie is cleared by a successful API response only. */ }
      location.replace("/admin/login.html");
    });
  }

  async function initLogin() {
    try {
      await api.me();
      location.replace("/admin/");
      return;
    } catch (error) {
      if (error?.status !== 401) handleError(error);
    }
    const form = document.querySelector("#login-form");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearMessage();
      const button = form.querySelector("button[type=submit]");
      button.disabled = true;
      button.textContent = "正在登录…";
      try {
        await api.login(document.querySelector("#password").value);
        location.replace("/admin/");
      } catch (error) {
        handleError(error);
        button.disabled = false;
        button.textContent = "登录";
      }
    });
  }

  function postRow(post) {
    const row = document.createElement("article");
    row.className = "post-row";
    const details = document.createElement("div");
    const title = document.createElement("h3");
    const meta = document.createElement("p");
    const edit = document.createElement("a");
    title.textContent = post.title;
    meta.textContent = [post.date, post.location, post.slug].filter(Boolean).join(" · ");
    edit.className = "button";
    edit.href = `editor.html?slug=${encodeURIComponent(post.slug)}`;
    edit.textContent = "编辑";
    details.append(title, meta);
    row.append(details, edit);
    return row;
  }

  async function initPosts() {
    if (!(await requireSession())) return;
    attachLogout();
    const list = document.querySelector("#post-list");
    try {
      const posts = await api.posts();
      list.replaceChildren();
      list.setAttribute("aria-busy", "false");
      if (!posts.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "还没有文章，先写第一篇吧。";
        list.append(empty);
        return;
      }
      posts.forEach((post) => list.append(postRow(post)));
    } catch (error) { handleError(error); }
  }

  function slugify(value) {
    return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
      .replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 100).replace(/-$/g, "");
  }

  function localDate() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - offset).toISOString().slice(0, 10);
  }

  async function initEditor() {
    if (!(await requireSession())) return;
    attachLogout();
    const form = document.querySelector("#post-form");
    const title = document.querySelector("#title");
    const postLocation = document.querySelector("#location");
    const slug = document.querySelector("#slug");
    const date = document.querySelector("#date");
    const description = document.querySelector("#description");
    const cover = document.querySelector("#cover");
    const coverFileInput = document.querySelector("#cover-file");
    const coverPreview = document.querySelector("#cover-preview");
    const content = document.querySelector("#content");
    const preview = document.querySelector("#preview");
    const fileInput = document.querySelector("#image-file");
    const editorPane = document.querySelector(".editor-pane");
    const deleteButton = document.querySelector("#delete-post");
    const publishButtons = document.querySelectorAll('button[type="submit"]');
    const requestedSlug = new URLSearchParams(location.search).get("slug");
    let currentSlug = requestedSlug;

    date.value = localDate();
    const updatePreview = () => { preview.innerHTML = window.BlogMarkdown.render(content.value); };
    const updateCoverPreview = () => {
      const value = cover.value.trim();
      if (!value) {
        coverPreview.hidden = true;
        coverPreview.removeAttribute("src");
        return;
      }
      coverPreview.src = value;
      coverPreview.hidden = false;
    };
    content.addEventListener("input", updatePreview);
    slug.addEventListener("input", () => { slug.value = slugify(slug.value); });
    cover.addEventListener("input", updateCoverPreview);
    updatePreview();

    if (requestedSlug) {
      try {
        const post = await api.post(requestedSlug);
        title.value = post.title;
        postLocation.value = post.location || "";
        slug.value = post.slug;
        slug.readOnly = true;
        document.querySelector("#slug-help").textContent = "文章发布后不能修改链接。";
        date.value = post.date;
        description.value = post.description || "";
        cover.value = post.cover || "";
        content.value = post.content;
        document.querySelector("#editor-title").textContent = "编辑文章";
        deleteButton.hidden = false;
        updateCoverPreview();
        updatePreview();
      } catch (error) { handleError(error); return; }
    }

    function insertAtCursor(text) {
      const start = content.selectionStart;
      const end = content.selectionEnd;
      content.setRangeText(text, start, end, "end");
      content.focus();
      content.dispatchEvent(new Event("input"));
    }

    async function upload(file, destination) {
      if (!file) return;
      clearMessage();
      const isCover = destination === "cover";
      const input = isCover ? coverFileInput : fileInput;
      const uploadLabel = document.querySelector(isCover ? "#cover-upload-label" : "#content-upload-label");
      const original = uploadLabel.textContent;
      uploadLabel.textContent = "正在上传…";
      input.disabled = true;
      try {
        const image = await api.uploadImage(file);
        if (isCover) {
          cover.value = image.url;
          updateCoverPreview();
          showMessage("封面图片上传成功。", "success");
        } else {
          insertAtCursor(`\n![图片](${image.url})\n`);
          showMessage("图片上传成功，已插入正文。", "success");
        }
      } catch (error) { handleError(error); }
      finally { uploadLabel.textContent = original; input.disabled = false; input.value = ""; }
    }

    coverFileInput.addEventListener("change", () => upload(coverFileInput.files[0], "cover"));
    fileInput.addEventListener("change", () => upload(fileInput.files[0], "content"));
    ["dragenter", "dragover"].forEach((name) => editorPane.addEventListener(name, (event) => {
      event.preventDefault(); editorPane.classList.add("dragging");
    }));
    ["dragleave", "drop"].forEach((name) => editorPane.addEventListener(name, (event) => {
      event.preventDefault(); editorPane.classList.remove("dragging");
    }));
    editorPane.addEventListener("drop", (event) => upload(event.dataTransfer?.files?.[0], "content"));

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearMessage();
      if (!form.reportValidity()) return;
      publishButtons.forEach((button) => { button.disabled = true; });
      const post = {
        title: title.value,
        location: postLocation.value,
        slug: slug.value,
        date: date.value,
        description: description.value,
        cover: cover.value,
        content: content.value,
      };
      try {
        const result = currentSlug ? await api.updatePost(currentSlug, post) : await api.createPost(post);
        if (!currentSlug) {
          currentSlug = result.slug;
          slug.value = result.slug;
          slug.readOnly = true;
          document.querySelector("#slug-help").textContent = "文章发布后不能修改链接。";
          deleteButton.hidden = false;
          history.replaceState(null, "", `editor.html?slug=${encodeURIComponent(currentSlug)}`);
          document.querySelector("#editor-title").textContent = "编辑文章";
        }
        showMessage("发布成功，GitHub Pages 将在稍后更新。", "success");
        if (result.url) {
          const link = document.createElement("a");
          link.href = result.url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = " 查看 GitHub 提交。";
          message.append(link);
        }
      } catch (error) { handleError(error); }
      finally { publishButtons.forEach((button) => { button.disabled = false; }); }
    });

    deleteButton.addEventListener("click", async () => {
      if (!currentSlug || !confirm("确定删除这篇文章吗？已经上传的图片不会自动删除。")) return;
      deleteButton.disabled = true;
      try {
        await api.deletePost(currentSlug);
        location.replace("/admin/");
      } catch (error) { handleError(error); deleteButton.disabled = false; }
    });
  }

  if (page === "login") initLogin();
  if (page === "posts") initPosts();
  if (page === "editor") initEditor();
})();
