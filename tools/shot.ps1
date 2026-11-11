param(
  [string]$Hash = "cam=1",
  [string]$Out = "E:\AIGC\html\_build\shot.png",
  [int]$WaitSec = 20,
  [int]$Width = 1400,
  [int]$Height = 950,
  [int]$Port = 9445
)

# 截图：正常带窗口的 Chrome（走 GPU 显卡）+ CDP 抓图。
# 绝不使用 --headless / --disable-gpu / swiftshader —— 那会把活压到 CPU 上，用户电脑会卡。
# 见 ~/.dsh/AGENTS.md「跑浏览器 / 截图」（2026-11-11 教训）。
# 窗口放在屏幕外 + 关闭遮挡节流，所以不会占你屏幕、也不会因为被挡住而停帧。

$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$node   = "C:\Program Files\nodejs\node.exe"
$prof   = "E:\AIGC\html\_build\_prof_shot"
if (Test-Path $prof) { Remove-Item $prof -Recurse -Force -ErrorAction SilentlyContinue }
if (Test-Path $Out)  { Remove-Item $Out -Force }

$url = "file:///E:/AIGC/html/sakura/dist/index.html#$Hash"

$cargs = @(
  "--remote-debugging-port=$Port",
  "--no-first-run",
  "--no-default-browser-check",
  "--allow-file-access-from-files",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-features=CalculateNativeWinOcclusion",
  "--window-position=6000,0",
  "--window-size=$Width,$Height",
  "--user-data-dir=$prof",
  "--new-window",
  $url
)

$p = Start-Process -FilePath $chrome -ArgumentList $cargs -PassThru
Start-Sleep -Seconds 2

& $node "E:\AIGC\html\sakura\tools\cdp_shot.mjs" $Port $Out ($WaitSec * 1000)

# 关掉临时窗口与进程
try {
  Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
    Where-Object { $_.CommandLine -like "*_prof_shot*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch {}
