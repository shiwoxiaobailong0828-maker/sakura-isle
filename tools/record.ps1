param(
  [int]$Frames = 300,
  [int]$Port = 9448,
  [string]$OutMp4 = "E:\AIGC\html\sakura\media\tour.mp4",
  [string]$OutCover = "E:\AIGC\html\_build\tour-cover.jpg",
  [string]$Ffmpeg = ""
)

$ErrorActionPreference = "Stop"
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$node   = "C:\Program Files\nodejs\node.exe"

# ffmpeg 自动探测：优先用参数传入，其次常见安装位置，最后查 PATH
if ([string]::IsNullOrWhiteSpace($Ffmpeg)) {
  $cands = @(
    "D:\openfilm\resources\runtime\ffmpeg\ffmpeg.exe",
    "E:\AIGC\html\_build\ffmpeg.exe",
    "C:\ffmpeg\bin\ffmpeg.exe"
  )
  $onPath = Get-Command ffmpeg -ErrorAction SilentlyContinue
  if ($onPath) { $cands += $onPath.Source }
  foreach ($c in $cands) {
    if ($c -and (Test-Path $c)) { $Ffmpeg = $c; break }
  }
}
if ([string]::IsNullOrWhiteSpace($Ffmpeg) -or -not (Test-Path $Ffmpeg)) {
  throw "找不到 ffmpeg。请用 -Ffmpeg 指定完整路径，例如：-Ffmpeg 'D:\openfilm\resources\runtime\ffmpeg\ffmpeg.exe'"
}
Write-Host ("ffmpeg: " + $Ffmpeg)

$prof   = "E:\AIGC\html\_build\_prof_rec"
$bin    = "E:\AIGC\html\_build\frames.bin"
$wav    = "E:\AIGC\html\_build\sakura_bgm.wav"
New-Item -ItemType Directory -Force -Path "E:\AIGC\html\_build" | Out-Null

try {
  Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
    Where-Object { $_.CommandLine -like "*_prof_rec*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch {}
Start-Sleep -Milliseconds 500

if (Test-Path $prof) { Remove-Item $prof -Recurse -Force -ErrorAction SilentlyContinue }
if (Test-Path $bin)  { Remove-Item $bin -Force -ErrorAction SilentlyContinue }
if (Test-Path $wav)  { Remove-Item $wav -Force -ErrorAction SilentlyContinue }

# 1. 生成双声道 BGM
& $node "E:\AIGC\html\sakura\tools\gen_bgm.mjs" $wav

# 2. 用真实 GPU 的 Chrome 窗口逐帧录制（12.0 秒 @ 25fps）
$url = "file:///E:/AIGC/html/sakura/dist/index.html#tour"
$cargs = @(
  "--remote-debugging-port=$Port",
  "--no-first-run",
  "--no-default-browser-check",
  "--allow-file-access-from-files",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-features=CalculateNativeWinOcclusion",
  "--window-position=6000,0",
  "--window-size=1280,720",
  "--user-data-dir=$prof",
  "--new-window",
  $url
)

$p = Start-Process -FilePath $chrome -ArgumentList $cargs -PassThru
Start-Sleep -Seconds 2

try {
  & $node "E:\AIGC\html\sakura\tools\cdp_record.mjs" $Port $bin $OutCover $Frames
} finally {
  try {
    Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
      Where-Object { $_.CommandLine -like "*_prof_rec*" } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  } catch {}
}

# 3. frames.bin + BGM 合成为 H.264 + AAC 的 mp4
& $Ffmpeg -y -f image2pipe -framerate 25 -i $bin -i $wav -c:v libx264 -preset slow -crf 22 -maxrate 6500k -bufsize 13000k -pix_fmt yuv420p -c:a aac -b:a 192k -shortest -movflags +faststart $OutMp4

Write-Host ("VIDEO READY: " + $OutMp4 + " (" + [math]::Round((Get-Item $OutMp4).Length / 1MB, 2) + " MB)")