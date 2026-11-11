// cdp_record.mjs — 通过 Chrome DevTools Protocol 在真实 GPU 窗口中逐帧录制宣传片 + 1280x800 实机封面
// 用法: node cdp_record.mjs <port> <frames.bin> <cover.jpg> [totalFrames]
import fs from 'node:fs';

const port = process.argv[2] || '9448';
const outBin = process.argv[3] || 'E:\\AIGC\\html\\_build\\frames.bin';
const outCover = process.argv[4] || 'E:\\AIGC\\html\\_build\\cover-1280x800.jpg';
const totalFrames = Number(process.argv[5] || 300);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget(retries = 50) {
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
await send('Emulation.setDeviceMetricsOverride', {
  width: 1280,
  height: 720,
  deviceScaleFactor: 1,
  mobile: false,
});

// 等待页面加载就绪并完成 HDRI 解码
const t0 = Date.now();
while (Date.now() - t0 < 25000) {
  const r = await send('Runtime.evaluate', {
    expression: `Boolean(window.__TOUR_READY__ && window.__sakura)`,
    returnByValue: true,
  });
  if (r.result && r.result.result && r.result.result.value === true) break;
  await sleep(300);
}
await sleep(900);

const fd = fs.openSync(outBin, 'w');
const tStart = Date.now();
for (let i = 0; i < totalFrames; i++) {
  await send('Runtime.evaluate', {
    expression: `window.__TOUR_SEEK__(${i}, ${totalFrames})`,
    returnByValue: true,
  });
  const shot = await send('Page.captureScreenshot', {
    format: 'jpeg',
    quality: 92,
    captureBeyondViewport: false,
  });
  const b64 = shot.result && shot.result.data;
  if (!b64) {
    throw new Error(`Missing screenshot data at frame ${i}`);
  }
  const buf = Buffer.from(b64, 'base64');
  fs.writeSync(fd, buf);
  if ((i + 1) % 50 === 0 || i === totalFrames - 1) {
    const sec = ((Date.now() - tStart) / 1000).toFixed(1);
    console.log(`recorded ${i + 1} / ${totalFrames} frames (${sec}s)`);
  }
}
fs.closeSync(fd);

// 随后切换至 1280x800 截取标准杂志画册实机封面（隐藏右上角宣传片角标）
await send('Emulation.setDeviceMetricsOverride', {
  width: 1280,
  height: 800,
  deviceScaleFactor: 1,
  mobile: false,
});
await sleep(200);
await send('Runtime.evaluate', {
  expression: `(() => {
    window.__TOUR_SEEK__(${totalFrames - 1}, ${totalFrames});
    document.querySelectorAll('body > div').forEach(el => {
      if (el.textContent && el.textContent.indexOf('Sakura Isle') >= 0 && el.style.position === 'fixed') {
        el.style.display = 'none';
      }
    });
    window.__sakura.post.render(0.016);
    return true;
  })()`,
  returnByValue: true,
});
await sleep(150);
const coverShot = await send('Page.captureScreenshot', {
  format: 'jpeg',
  quality: 92,
  captureBeyondViewport: false,
});
if (coverShot.result && coverShot.result.data) {
  fs.writeFileSync(outCover, Buffer.from(coverShot.result.data, 'base64'));
  console.log(`cover: ${(fs.statSync(outCover).size / 1024).toFixed(0)} KB -> ${outCover}`);
}

ws.close();
process.exit(0);
