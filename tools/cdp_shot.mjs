// cdp_shot.mjs — 通过 Chrome DevTools Protocol 截图（走 GPU，窗口在屏幕外也不影响）
// 用法: node cdp_shot.mjs <port> <out.png> [waitMs]
const port = process.argv[2] || '9445';
const out = process.argv[3] || 'shot.png';
const waitMs = Number(process.argv[4] || 14000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget(retries = 40) {
  for (let i = 0; i < retries; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && /^file:/.test(t.url))
        || list.find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error('CDP target not found');
}

const page = await getTarget();
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

await send('Page.enable');
await send('Runtime.enable');

// 等页面把加载界面收掉（最多等 waitMs）
const t0 = Date.now();
let ready = false;
while (Date.now() - t0 < waitMs) {
  const r = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      api: !!window.__sakura,
      loader: (() => { const l = document.querySelector('.loader,#loader,#loading');
        if (!l) return 'none';
        const s = getComputedStyle(l);
        return s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0' ? 'hidden' : 'shown'; })()
    })`,
    returnByValue: true,
  });
  try {
    const st = JSON.parse(r.result.result.value);
    if (st.api && st.loader !== 'shown') { ready = true; break; }
  } catch {}
  await sleep(400);
}
await sleep(1200); // 让首帧稳定、相机动画落位

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
const data = shot.result && shot.result.data;
if (!data) {
  console.log('ERR: no screenshot data');
  process.exit(1);
}
const fs = await import('node:fs');
fs.writeFileSync(out, Buffer.from(data, 'base64'));
console.log(`shot: ${(fs.statSync(out).size / 1024).toFixed(0)} KB (CDP/${ready ? 'ready' : 'timeout'})`);
ws.close();
process.exit(0);
