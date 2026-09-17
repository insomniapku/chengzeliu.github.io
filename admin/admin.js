(() => {
  "use strict";

  const api = window.BlogApi;
  const page = document.body.dataset.page;
  const message = document.querySelector("#message");

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
    showMessage(error?.message || "Something went wrong. Please try again.");
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
      button.textContent = "Signing in…";
      try {
        await api.login(document.querySelector("#password").value);
        location.replace("/admin/");
      } catch (error) {
        handleError(error);
        button.disabled = false;
        button.textContent = "Sign in";
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
    meta.textContent = `${post.date} · ${post.slug}`;
    edit.className = "button";
    edit.href = `editor.html?slug=${encodeURIComponent(post.slug)}`;
    edit.textContent = "Edit";
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
        empty.textContent = "No posts yet. Create the first one.";
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
    const slug = document.querySelector("#slug");
    const date = document.querySelector("#date");
    const description = document.querySelector("#description");
    const cover = document.querySelector("#cover");
    const content = document.querySelector("#content");
    const preview = document.querySelector("#preview");
    const fileInput = document.querySelector("#image-file");
    const editorPane = document.querySelector(".editor-pane");
    const deleteButton = document.querySelector("#delete-post");
    const publishButtons = document.querySelectorAll('button[type="submit"]');
    const requestedSlug = new URLSearchParams(location.search).get("slug");
    let currentSlug = requestedSlug;
    let slugTouched = Boolean(requestedSlug);

    date.value = localDate();
    const updatePreview = () => { preview.innerHTML = window.BlogMarkdown.render(content.value); };
    content.addEventListener("input", updatePreview);
    title.addEventListener("input", () => { if (!slugTouched) slug.value = slugify(title.value); });
    slug.addEventListener("input", () => { slugTouched = true; slug.value = slugify(slug.value); });
    updatePreview();

    if (requestedSlug) {
      try {
        const post = await api.post(requestedSlug);
        title.value = post.title;
        slug.value = post.slug;
        slug.readOnly = true;
        document.querySelector("#slug-help").textContent = "Slug is fixed after publication.";
        date.value = post.date;
        description.value = post.description || "";
        cover.value = post.cover || "";
        content.value = post.content;
        document.querySelector("#editor-title").textContent = "Edit post";
        deleteButton.hidden = false;
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

    async function upload(file) {
      if (!file) return;
      clearMessage();
      const uploadLabel = document.querySelector(".upload-button span");
      const original = uploadLabel.textContent;
      uploadLabel.textContent = "Uploading…";
      fileInput.disabled = true;
      try {
        const image = await api.uploadImage(file);
        insertAtCursor(`\n![Image](${image.url})\n`);
        showMessage("Image uploaded and inserted into the Markdown.", "success");
      } catch (error) { handleError(error); }
      finally { uploadLabel.textContent = original; fileInput.disabled = false; fileInput.value = ""; }
    }

    fileInput.addEventListener("change", () => upload(fileInput.files[0]));
    ["dragenter", "dragover"].forEach((name) => editorPane.addEventListener(name, (event) => {
      event.preventDefault(); editorPane.classList.add("dragging");
    }));
    ["dragleave", "drop"].forEach((name) => editorPane.addEventListener(name, (event) => {
      event.preventDefault(); editorPane.classList.remove("dragging");
    }));
    editorPane.addEventListener("drop", (event) => upload(event.dataTransfer?.files?.[0]));

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearMessage();
      if (!form.reportValidity()) return;
      publishButtons.forEach((button) => { button.disabled = true; });
      const post = {
        title: title.value,
        slug: slug.value,
        date: date.value,
        description: description.value,
        cover: cover.value,
        content: content.value,
      };
      try {
        const result = currentSlug ? await api.updatePost(currentSlug, post) : await api.createPost(post);
        if (!currentSlug) {
          currentSlug = post.slug;
          slug.readOnly = true;
          deleteButton.hidden = false;
          history.replaceState(null, "", `editor.html?slug=${encodeURIComponent(currentSlug)}`);
          document.querySelector("#editor-title").textContent = "Edit post";
        }
        showMessage("Published successfully. GitHub Pages will update shortly.", "success");
        if (result.url) {
          const link = document.createElement("a");
          link.href = result.url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = " View commit.";
          message.append(link);
        }
      } catch (error) { handleError(error); }
      finally { publishButtons.forEach((button) => { button.disabled = false; }); }
    });

    deleteButton.addEventListener("click", async () => {
      if (!currentSlug || !confirm("Delete this post? Images will not be deleted.")) return;
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

