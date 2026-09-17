(() => {
  "use strict";

  function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
    })[character]);
  }

  function safeUrl(raw, image = false) {
    const value = raw.trim();
    if (!value || /[\u0000-\u001f\u007f]/.test(value)) return null;
    if (value.startsWith("/") && !value.startsWith("//")) return value;
    if (value.startsWith("#") && !image) return value;
    try {
      const parsed = new URL(value, location.origin);
      const allowed = image ? ["https:", "http:"] : ["https:", "http:", "mailto:"];
      return allowed.includes(parsed.protocol) ? value : null;
    } catch {
      return null;
    }
  }

  function renderInline(text) {
    const pattern = /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
    let html = "";
    let offset = 0;
    for (const match of text.matchAll(pattern)) {
      html += escapeHtml(text.slice(offset, match.index));
      if (match[1] !== undefined) {
        const url = safeUrl(match[2], true);
        html += url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(match[1])}">` : escapeHtml(match[0]);
      } else if (match[3] !== undefined) {
        const url = safeUrl(match[4], false);
        html += url
          ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(match[3])}</a>`
          : escapeHtml(match[0]);
      } else if (match[5] !== undefined) {
        html += `<code>${escapeHtml(match[5])}</code>`;
      } else if (match[6] !== undefined) {
        html += `<strong>${escapeHtml(match[6])}</strong>`;
      } else {
        html += `<em>${escapeHtml(match[7])}</em>`;
      }
      offset = match.index + match[0].length;
    }
    return html + escapeHtml(text.slice(offset));
  }

  function render(markdown) {
    const lines = markdown.replace(/\r\n/g, "\n").split("\n");
    const output = [];
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) { index += 1; continue; }

      const fence = line.match(/^```([a-z0-9_+-]*)\s*$/i);
      if (fence) {
        const code = [];
        index += 1;
        while (index < lines.length && !/^```\s*$/.test(lines[index])) code.push(lines[index++]);
        if (index < lines.length) index += 1;
        const language = fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : "";
        output.push(`<pre><code${language}>${escapeHtml(code.join("\n"))}</code></pre>`);
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        const level = heading[1].length;
        output.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
        index += 1;
        continue;
      }
      if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        output.push("<hr>"); index += 1; continue;
      }
      if (/^>\s?/.test(line)) {
        const quoted = [];
        while (index < lines.length && /^>\s?/.test(lines[index])) quoted.push(lines[index++].replace(/^>\s?/, ""));
        output.push(`<blockquote>${render(quoted.join("\n"))}</blockquote>`);
        continue;
      }
      const unordered = line.match(/^\s*[-+*]\s+(.+)$/);
      const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (unordered || ordered) {
        const tag = unordered ? "ul" : "ol";
        const items = [];
        const itemPattern = unordered ? /^\s*[-+*]\s+(.+)$/ : /^\s*\d+[.)]\s+(.+)$/;
        while (index < lines.length) {
          const item = lines[index].match(itemPattern);
          if (!item) break;
          items.push(`<li>${renderInline(item[1])}</li>`);
          index += 1;
        }
        output.push(`<${tag}>${items.join("")}</${tag}>`);
        continue;
      }

      const paragraph = [line.trim()];
      index += 1;
      while (
        index < lines.length && lines[index].trim() &&
        !/^(?:#{1,6}\s|```|>\s?|\s*[-+*]\s+|\s*\d+[.)]\s+|(?:-{3,}|\*{3,}|_{3,})\s*$)/.test(lines[index])
      ) paragraph.push(lines[index++].trim());
      output.push(`<p>${renderInline(paragraph.join("\n")).replace(/\n/g, "<br>")}</p>`);
    }
    return output.join("\n");
  }

  window.BlogMarkdown = Object.freeze({ render });
})();

