param(
  [string]$Steps = "E:\AIGC\html\sakura\tools\probe_steps.json",
  [int]$Port = 9333
)
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$prof = "E:\AIGC\html\_build\_prof_probe"
if (Test-Path $prof) { Remove-Item $prof -Recurse -Force -ErrorAction SilentlyContinue }
$flags = @(
  "--headless=new","--no-sandbox","--disable-gpu-sandbox",
  "--allow-file-access-from-files","--enable-unsafe-swiftshader",
  "--use-gl=angle","--use-angle=swiftshader","--hide-scrollbars",
  "--window-size=1400,950","--user-data-dir=$prof",
  "--remote-debugging-port=$Port",
  "file:///E:/AIGC/html/sakura/dist/index.html#snap"
)
$proc = Start-Process -FilePath $chrome -ArgumentList $flags -PassThru
Start-Sleep -Seconds 3
$node = "C:\Users\bailong\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$out = & $node "E:\AIGC\html\_build\probe.js" $Steps 2>&1
$proc | Stop-Process -Force -ErrorAction SilentlyContinue
# 落盘截图
foreach ($line in $out) {
  if ($line -match '^SHOT:(.+?):([A-Za-z0-9+/=]+):ENDSHOT$') {
    $path = $matches[1]; $b64 = $matches[2]
    [System.IO.File]::WriteAllBytes($path, [Convert]::FromBase64String($b64))
    Write-Output ("saved " + $path)
  } elseif ($line -notmatch 'ENDSHOT' -and $line.Length -lt 2000) {
    Write-Output $line
  }
}
