(() => {
  "use strict";

  const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const baseUrl = local ? `http://${location.hostname}:8787` : "https://api.chengzeliu.com";

  class ApiError extends Error {
    constructor(status, code, message) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.code = code;
    }
  }

  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/json");
    if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");

    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, { ...options, headers, credentials: "include" });
    } catch {
      throw new ApiError(0, "NETWORK_ERROR", "无法连接博客服务，请检查网络后重试。");
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new ApiError(response.status, "INVALID_RESPONSE", "博客服务返回了无法读取的响应。");
    }
    if (!response.ok || !payload.ok) {
      throw new ApiError(
        response.status,
        payload.error?.code || "API_ERROR",
        payload.error?.message || "操作未能完成。",
      );
    }
    return payload.data;
  }

  window.BlogApi = Object.freeze({
    ApiError,
    me: () => request("/api/auth/me"),
    login: (password) => request("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) }),
    logout: () => request("/api/auth/logout", { method: "POST" }),
    posts: () => request("/api/posts"),
    post: (slug) => request(`/api/posts/${encodeURIComponent(slug)}`),
    createPost: (post) => request("/api/posts", { method: "POST", body: JSON.stringify(post) }),
    updatePost: (slug, post) => request(`/api/posts/${encodeURIComponent(slug)}`, { method: "PUT", body: JSON.stringify(post) }),
    deletePost: (slug) => request(`/api/posts/${encodeURIComponent(slug)}`, { method: "DELETE" }),
    uploadImage: (file) => {
      const body = new FormData();
      body.append("file", file);
      return request("/api/images", { method: "POST", body });
    },
    deleteImage: (key) => request(`/api/images/${encodeURIComponent(key)}`, { method: "DELETE" }),
  });
})();
