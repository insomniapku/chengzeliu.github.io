# chengzeliu.github.io
personal page

## Sync blog posts

After writing public posts in the local blog at `D:\blog`, run:

```powershell
.\sync-blog-to-homepage.ps1
```

On Windows, you can also double-click `sync-blog-to-homepage.bat`.

The script reads public posts from `D:\blog\data\posts.json`, updates the Blog section in `index.html`, commits the change, and pushes it to GitHub.
