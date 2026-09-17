$ErrorActionPreference = "Stop"

$homepageDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$postsDir = Join-Path $homepageDir "_posts"
$blogDataPath = "D:\blog\data\posts.json"

function ConvertTo-Slug {
  param([string]$Value)

  $normalized = $Value.Normalize([Text.NormalizationForm]::FormD).ToLowerInvariant()
  $slug = [regex]::Replace($normalized, "[^a-z0-9]+", "-").Trim("-")
  if ($slug.Length -gt 100) {
    $slug = $slug.Substring(0, 100).TrimEnd("-")
  }
  return $slug
}

function ConvertTo-YamlString {
  param([AllowEmptyString()][string]$Value)
  return ($Value | ConvertTo-Json -Compress)
}

if (-not (Test-Path -LiteralPath $blogDataPath)) {
  throw "Cannot find blog data at $blogDataPath"
}

New-Item -ItemType Directory -Force -Path $postsDir | Out-Null
$allPosts = @(Get-Content -LiteralPath $blogDataPath -Raw -Encoding UTF8 | ConvertFrom-Json)
$posts = @($allPosts | Where-Object { $_.visibility -eq "public" })

foreach ($post in $posts) {
  $date = ([datetime]$post.createdAt).ToLocalTime().ToString("yyyy-MM-dd")
  $existing = Get-ChildItem -LiteralPath $postsDir -Filter "*.md" -File |
    Where-Object { Select-String -LiteralPath $_.FullName -SimpleMatch "source_id: `"$($post.id)`"" -Quiet } |
    Select-Object -First 1

  if ($existing) {
    $target = $existing.FullName
    $slug = $existing.BaseName.Substring(11)
  }
  else {
    $slug = ConvertTo-Slug $post.title
    if ([string]::IsNullOrWhiteSpace($slug)) {
      $slug = "local-" + $post.id.Substring(0, 8)
    }
    $target = Join-Path $postsDir "$date-$slug.md"
  }

  $description = (($post.content -split "`r?`n" | Select-Object -First 1) -join " ").Trim()
  if ($description.Length -gt 160) {
    $description = $description.Substring(0, 157) + "..."
  }
  $location = if ([string]::IsNullOrWhiteSpace($post.location)) { $post.ipCity } else { $post.location }

  $frontMatter = @(
    "---"
    "layout: post"
    "title: $(ConvertTo-YamlString $post.title)"
    "date: $date"
    "slug: $slug"
    "description: $(ConvertTo-YamlString $description)"
    "location: $(ConvertTo-YamlString $location)"
    "source_id: $(ConvertTo-YamlString $post.id)"
    "---"
    ""
    ""
  ) -join "`n"
  $markdown = $frontMatter + ($post.content.Trim() -replace "`r`n", "`n") + "`n"
  Set-Content -LiteralPath $target -Value $markdown -Encoding UTF8
}

Push-Location $homepageDir
try {
  git add _posts | Out-Null
  git diff --cached --quiet
  if ($LASTEXITCODE -eq 0) {
    Write-Host "Markdown posts are already up to date."
    exit 0
  }

  $message = "Import public blog posts " + (Get-Date -Format "yyyy-MM-dd HH:mm")
  git commit -m $message
  if ($LASTEXITCODE -ne 0) { throw "Git commit failed. Please check the message above." }
  git push origin main
  if ($LASTEXITCODE -ne 0) { throw "Posts were imported locally, but upload to GitHub failed." }
  Write-Host "Done. Public local entries are now Markdown posts in _posts."
}
finally {
  Pop-Location
}
