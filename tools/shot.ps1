param([string]$Hash = "cam=1", [string]$Out = "E:\AIGC\html\_build\shot.png")
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$prof = "E:\AIGC\html\_build\_prof_shot"
if (Test-Path $Out) { Remove-Item $Out -Force }
if (Test-Path $prof) { Remove-Item $prof -Recurse -Force -ErrorAction SilentlyContinue }
$flags = @(
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu-sandbox",
  "--allow-file-access-from-files",
  "--enable-unsafe-swiftshader",
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--hide-scrollbars",
  "--window-size=1400,950",
  "--screenshot=$Out",
  "--virtual-time-budget=90000",
  "--user-data-dir=$prof",
  "--dump-dom",
  "file:///E:/AIGC/html/sakura/dist/index.html#$Hash"
)
& $chrome @flags 2>&1 | Out-File "E:\AIGC\html\_build\shot_dom.txt" -Encoding UTF8
$t = [System.IO.File]::ReadAllText("E:\AIGC\html\_build\shot_dom.txt", [System.Text.Encoding]::UTF8)
if ($t -match 'Uncaught [^<\n]{0,200}') { "ERR: " + $matches[0] } else { "no js errors" }
if (Test-Path $Out) { "shot: " + [math]::Round((Get-Item $Out).Length/1KB,0) + " KB" } else { "no shot" }
