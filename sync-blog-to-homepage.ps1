$ErrorActionPreference = "Stop"

$homepageDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$indexPath = Join-Path $homepageDir "index.html"
$blogDataPath = "D:\blog\data\posts.json"

function Escape-Html {
  param([AllowNull()][string]$Value)

  if ($null -eq $Value) {
    return ""
  }

  $escaped = $Value.Replace("&", "&amp;")
  $escaped = $escaped.Replace("<", "&lt;")
  $escaped = $escaped.Replace(">", "&gt;")
  $escaped = $escaped.Replace([string][char]34, "&quot;")
  $escaped = $escaped.Replace("'", "&#039;")
  return $escaped
}

function Get-PostDate {
  param($Post)

  if ($Post.title -match "^\d{8}$") {
    return "{0}-{1}-{2}" -f $Post.title.Substring(0, 4), $Post.title.Substring(4, 2), $Post.title.Substring(6, 2)
  }

  return ([datetime]$Post.createdAt).ToLocalTime().ToString("yyyy-MM-dd")
}

function Get-LocationLabel {
  param($Post)

  $location = $Post.location
  if ([string]::IsNullOrWhiteSpace($location)) {
    $location = $Post.ipCity
  }

  if ([string]::IsNullOrWhiteSpace($location)) {
    return "Location not specified"
  }

  if ($location -eq "北京市海淀区") {
    return "Beijing Haidian"
  }

  return $location
}

if (-not (Test-Path $blogDataPath)) {
  throw "Cannot find blog data at $blogDataPath"
}

if (-not (Test-Path $indexPath)) {
  throw "Cannot find homepage file at $indexPath"
}

$allPosts = @(Get-Content $blogDataPath -Raw -Encoding UTF8 | ConvertFrom-Json)
$posts = @($allPosts |
  Where-Object { $_.visibility -eq "public" } |
  Sort-Object { [datetime]$_.createdAt } -Descending)

$cards = @(
foreach ($post in $posts) {
  $date = Escape-Html (Get-PostDate $post)
  $location = Escape-Html (Get-LocationLabel $post)
  $title = Escape-Html ($(if ([string]::IsNullOrWhiteSpace($post.title)) { "Untitled" } else { $post.title }))
  $content = Escape-Html $post.content

@"
        <article class="post">
          <div class="meta">$date · $location</div>
          <h3>$title</h3>
          <p class="post-content">$content</p>
          <div class="post-footer"><span class="tag">Public</span><span>From local blog</span></div>
        </article>
"@
}
)

if ($cards.Count -eq 0) {
  $cards = @"
        <article class="post">
          <div class="meta">No public posts yet</div>
          <h3>Blog</h3>
          <p class="post-content">Public posts from the local blog will appear here.</p>
          <div class="post-footer"><span class="tag">Public</span><span>From local blog</span></div>
        </article>
"@
}

$content = Get-Content $indexPath -Raw -Encoding UTF8
$startMarker = "<!-- BLOG_POSTS_START -->"
$endMarker = "<!-- BLOG_POSTS_END -->"

if (-not $content.Contains($startMarker) -or -not $content.Contains($endMarker)) {
  throw "Cannot find blog sync markers in index.html"
}

$replacement = @"
        <!-- BLOG_POSTS_START -->
$($cards -join "`r`n`r`n")
        <!-- BLOG_POSTS_END -->
"@

$pattern = "(?s)\s*<!-- BLOG_POSTS_START -->.*?<!-- BLOG_POSTS_END -->"
$updated = [regex]::Replace($content, $pattern, "`r`n$replacement", 1)
Set-Content $indexPath $updated -Encoding UTF8

Push-Location $homepageDir
try {
  git add index.html | Out-Null

  git diff --cached --quiet
  if ($LASTEXITCODE -eq 0) {
    Write-Host "Homepage blog is already up to date."
    exit 0
  }

  $message = "Sync blog posts " + (Get-Date -Format "yyyy-MM-dd HH:mm")
  git commit -m $message
  if ($LASTEXITCODE -ne 0) {
    throw "Git commit failed. Please check the message above."
  }

  git push origin main
  if ($LASTEXITCODE -ne 0) {
    throw "Blog posts were synced locally, but upload to GitHub failed. Please check your network and run this script again."
  }

  Write-Host ""
  Write-Host "Done. Public blog posts have been synced and uploaded to GitHub."
}
finally {
  Pop-Location
}
