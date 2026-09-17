# chengzeliu.github.io

Personal homepage and Markdown blog for [chengzeliu.com](https://chengzeliu.com), published by GitHub Pages.

- Public posts live in `_posts/` and are rendered by Jekyll.
- The private editor lives at `/admin/`.
- The Cloudflare Worker API lives in `worker/`.
- Images are stored in Cloudflare R2.

See [BLOG_ADMIN.md](BLOG_ADMIN.md) for setup, secrets, deployment, and testing.

## Legacy local blog import

The optional `sync-blog-to-homepage.ps1` script now imports only public entries from
`D:\blog\data\posts.json` into `_posts/`. It no longer rewrites `index.html`.
