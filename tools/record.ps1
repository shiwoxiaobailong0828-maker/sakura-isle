param(
  [int]$Frames = 300,
  [int]$Port = 9448,
  [string]$OutMp4 = "E:\AIGC\html\sakura\media\tour.mp4",
  [string]$OutCover = "E:\AIGC\html\_build\tour-cover.jpg"
)

$ErrorActionPreference = "Stop"
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$node   = "C:\Program Files\nodejs\node.exe"
$ffmpeg = "E:\AIGC\html\_build\ffmpeg.exe"

$prof   = "E:\AIGC\html\_build\_prof_rec"
$bin    = "E:\AIGC\html\_build\frames.bin"
$wav    = "E:\AIGC\html\_build\sakura_bgm.wav"

try {
  Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
    Where-Object { $_.CommandLine -like "*_prof_rec*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch {}
Start-Sleep -Milliseconds 500

if (Test-Path $prof) { Remove-Item $prof -Recurse -Force -ErrorAction SilentlyContinue }
if (Test-Path $bin)  { Remove-Item $bin -Force -ErrorAction SilentlyContinue }
if (Test-Path $wav)  { Remove-Item $wav -Force -ErrorAction SilentlyContinue }

# 1. Generate stereo BGM
& $node "E:\AIGC\html\sakura\tools\gen_bgm.mjs" $wav

# 2. Launch real GPU Chrome offscreen and record 300 frames (12.0s @ 25fps)
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

# 3. Mux frames.bin + sakura_bgm.wav into H.264 + AAC mp4
& $ffmpeg -y -f image2pipe -framerate 25 -i $bin -i $wav -c:v libx264 -preset slow -crf 22 -maxrate 6500k -bufsize 13000k -pix_fmt yuv420p -c:a aac -b:a 192k -shortest -movflags +faststart $OutMp4

Write-Host ("VIDEO READY: " + $OutMp4 + " (" + [math]::Round((Get-Item $OutMp4).Length / 1MB, 2) + " MB)")
