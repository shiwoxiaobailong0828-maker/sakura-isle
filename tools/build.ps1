param([string]$Out = "")
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if ([string]::IsNullOrEmpty($Out)) { $Out = Join-Path $root "dist\index.html" }
$src = Join-Path $root "src"

$nl = [char]10
# Concatenate app_part1..4.js -> app.js
$parts = @(
  [System.IO.File]::ReadAllText("$src\app_part1.js", [System.Text.Encoding]::UTF8),
  [System.IO.File]::ReadAllText("$src\app_part2.js", [System.Text.Encoding]::UTF8),
  [System.IO.File]::ReadAllText("$src\app_part3.js", [System.Text.Encoding]::UTF8),
  [System.IO.File]::ReadAllText("$src\app_part4.js", [System.Text.Encoding]::UTF8)
)
[System.IO.File]::WriteAllText("$src\app.js", ($parts -join $nl), (New-Object System.Text.UTF8Encoding($false)))

$shell = [System.IO.File]::ReadAllText("$src\shell.html", [System.Text.Encoding]::UTF8)
$core  = [System.IO.File]::ReadAllText("$src\vendor\three.iife.js", [System.Text.Encoding]::UTF8)
$orbit = [System.IO.File]::ReadAllText("$src\vendor\orbit-controls.js", [System.Text.Encoding]::UTF8)
$app   = [System.IO.File]::ReadAllText("$src\app.js", [System.Text.Encoding]::UTF8)

# Inject base64 textures
$texWeb = Join-Path $root "textures\web"
function Get-B64([string]$name) {
  $p = Join-Path $texWeb $name
  if (Test-Path $p) { return [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($p)) }
  return "_"
}
$app = $app.Replace('__BARK_ALBEDO__', (Get-B64 'bark_albedo.jpg'))
$app = $app.Replace('__BARK_NORMAL__', (Get-B64 'bark_normal.jpg'))
$app = $app.Replace('__BARK_ROUGH__',  (Get-B64 'bark_rough.jpg'))
$app = $app.Replace('__BARK_AO__',     (Get-B64 'bark_ao.jpg'))
$app = $app.Replace('__HDRI_SUNSET__', (Get-B64 'sunset_hdri.jpg'))

$html = $shell.Replace('<!--SCRIPT_CORE-->',  '<script>' + $nl + $core  + $nl + '</script>')
$html = $html.Replace('<!--SCRIPT_ORBIT-->', '<script>' + $nl + $orbit + $nl + '</script>')
$html = $html.Replace('<!--SCRIPT_APP-->',   '<script>' + $nl + $app   + $nl + '</script>')

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Out) | Out-Null
[System.IO.File]::WriteAllText($Out, $html, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("built: " + $Out + "  " + [math]::Round((Get-Item $Out).Length/1MB, 2) + " MB")
