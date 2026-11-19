/* ─────────────────────────────────────────────────────────────
   ai.js — 「一句话 → 控制台代码」

   说明：这里不是调用远端大模型，而是一个本地意图引擎。
   它把常见操作映射成可靠的 DOM 片段，并用当前页面的事实
   （标题、段落数、图片数、链接数）填进代码里。
   好处是不联网、不花钱、不出错；要接真模型，只需把
   generate() 换成一次 fetch，返回同样的契约。
   ───────────────────────────────────────────────────────────── */

/** 页面事实：用于把代码写得更贴合当前界面。 */
export function pageFacts(win) {
  const f = { title: '', paras: 0, imgs: 0, links: 0, bodyFont: 16, bg: '#ffffff' };
  try {
    const d = win.document;
    f.title = d.title || '';
    f.paras = d.querySelectorAll('p').length;
    f.imgs = d.querySelectorAll('img').length;
    f.links = d.querySelectorAll('a[href]').length;
    const cs = win.getComputedStyle(d.body);
    f.bodyFont = parseFloat(cs.fontSize) || 16;
    f.bg = cs.backgroundColor;
  } catch {}
  return f;
}

const RULES = [
  {
    id: 'hide-noise',
    test: (q) => /隐藏|去掉|清除|关掉/.test(q) && /广告|弹窗|浮层|横幅|ad|popup/i.test(q),
    build: () => `/* 隐藏常见广告与浮层 */
const junk = [
  '[class*="ad-"]','[class*="ads"]','[id*="ad-"]','[id*="ads"]',
  '[class*="popup"]','[class*="modal"]','[class*="banner"]',
  '[class*="cookie"]','[class*="subscribe"]','[aria-label*="广告"]'
];
let n = 0;
for (const sel of junk) {
  document.querySelectorAll(sel).forEach(el => {
    if (el.offsetHeight < window.innerHeight * 0.9) { el.remove(); n++; }
  });
}
document.body.style.overflow = '';
console.log('移除元素', n);`,
  },
  {
    id: 'bigger-text',
    test: (q) => /放大|大一点|字太小|字号|看得清/.test(q) && !/图片/.test(q),
    build: (f) => `/* 正文放大到 ${Math.round(f.bodyFont * 1.25)}px，行距放宽 */
document.querySelectorAll('p, li, article').forEach(el => {
  el.style.fontSize = '${Math.round(f.bodyFont * 1.25)}px';
  el.style.lineHeight = '1.9';
  el.style.maxWidth = '46em';
  el.style.marginInline = 'auto';
});
console.log('已调整正文排版');`,
  },
  {
    id: 'smaller-text',
    test: (q) => /缩小|小一点|字太大/.test(q),
    build: (f) => `document.querySelectorAll('p, li, article').forEach(el => {
  el.style.fontSize = '${Math.max(12, Math.round(f.bodyFont * 0.85))}px';
});
console.log('正文缩小');`,
  },
  {
    id: 'dark',
    test: (q) => /夜间|深色|暗色|dark/i.test(q),
    build: () => `/* 页面级夜间模式（不改系统设置） */
const css = \`
  html { filter: invert(1) hue-rotate(180deg); background:#111 !important; }
  img, video, svg, canvas, [style*="background-image"] { filter: invert(1) hue-rotate(180deg); }
\`;
const s = document.createElement('style'); s.id='__yb_dark'; s.textContent = css;
document.getElementById('__yb_dark')?.remove();
document.head.appendChild(s);
console.log('已开启夜间模式');`,
  },
  {
    id: 'undark',
    test: (q) => /关闭夜间|恢复白天|亮色/.test(q),
    build: () => `document.getElementById('__yb_dark')?.remove(); console.log('已恢复');`,
  },
  {
    id: 'reading',
    test: (q) => /阅读|纯净|专心|专注/.test(q),
    build: () => `/* 阅读模式：只留标题与正文 */
const main = document.querySelector('article, main, [role="main"]') || document.body;
const title = document.title;
const text = main.innerText;
document.documentElement.innerHTML = \`
  <body style="margin:0;background:#FBFAF6;color:#23211D;font:${Math.round(18)}px/1.9 -apple-system,'Noto Sans SC',sans-serif">
    <div style="max-width:40em;margin:0 auto;padding:64px 24px">
      <h1 style="font-size:1.6em;line-height:1.35;margin:0 0 32px">\${title}</h1>
      <div style="white-space:pre-wrap">\${text}</div>
    </div>
  </body>\`;
console.log('阅读模式');`,
  },
  {
    id: 'links',
    test: (q) => /链接|所有网址|提取/.test(q),
    build: () => `/* 提取页面全部链接 */
const out = [...document.querySelectorAll('a[href]')]
  .map(a => ({ text: a.innerText.trim().slice(0, 60), href: a.href }))
  .filter(x => x.text);
console.table(out);
return out.length + ' 条链接';`,
  },
  {
    id: 'images',
    test: (q) => /图片|配图|下载图/.test(q),
    build: () => `/* 列出页面图片，按面积排序 */
const imgs = [...document.images]
  .map(i => ({ w: i.naturalWidth, h: i.naturalHeight, src: i.currentSrc || i.src }))
  .filter(i => i.w > 120)
  .sort((a, b) => b.w * b.h - a.w * a.h);
console.table(imgs.slice(0, 30));
return imgs.length + ' 张图';`,
  },
  {
    id: 'width',
    test: (q) => /居中|窄一点|宽度|行宽/.test(q),
    build: () => `/* 收窄正文测度，居中 */
document.querySelectorAll('article, main, [role="main"]').forEach(el => {
  el.style.maxWidth = '44em';
  el.style.marginInline = 'auto';
  el.style.paddingInline = '24px';
});
console.log('已收窄版心');`,
  },
  {
    id: 'speed',
    test: (q) => /视频|倍速|加快/.test(q),
    build: () => `const v = document.querySelector('video');
if (!v) { console.warn('页面没有 video 元素'); } else {
  v.playbackRate = Math.min(3, v.playbackRate + 0.5);
  console.log('倍速 →', v.playbackRate);
}`,
  },
  {
    id: 'remove-fixed',
    test: (q) => /吸顶|悬浮|悬浮栏|顶部条|底栏/.test(q),
    build: () => `/* 去掉 position:fixed 的条状元素 */
let n = 0;
document.querySelectorAll('body *').forEach(el => {
  const cs = getComputedStyle(el);
  if (cs.position === 'fixed' && el.offsetHeight < 140 && el.offsetWidth > window.innerWidth * 0.6) {
    el.remove(); n++;
  }
});
console.log('移除固定条', n);`,
  },
  {
    id: 'outline',
    test: (q) => /大纲|结构|标题列表/.test(q),
    build: () => `/* 生成页面大纲 */
const hs = [...document.querySelectorAll('h1,h2,h3')];
hs.forEach(h => console.log(' '.repeat((+h.tagName[1]-1)*2) + h.innerText.trim()));
return hs.length + ' 个标题';`,
  },
  {
    id: 'scroll',
    test: (q) => /回顶|顶部|起始/.test(q),
    build: () => `window.scrollTo({ top: 0, behavior: 'smooth' }); '已回到顶部'`,
  },
];

export function generate(query, facts = {}) {
  const q = String(query || '').trim();
  if (!q) return { code: '', note: '请输入一句需求。' };

  for (const r of RULES) {
    if (r.test(q)) {
      return { code: r.build(facts || {}), note: `匹配：${r.id}`, id: r.id };
    }
  }

  // 兜底：搜索 + 高亮关键词
  const kw = q.replace(/[，。！？,.!?]/g, ' ').trim().split(/\s+/).pop() || q;
  return {
    code: `/* 未匹配到固定动作，做「关键词高亮」：${kw} */
const kw = ${JSON.stringify(kw)};
const mark = (root) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const hits = [];
  let n;
  while ((n = walker.nextNode())) {
    if (n.nodeValue && n.nodeValue.includes(kw)) hits.push(n);
  }
  hits.forEach(node => {
    const span = document.createElement('mark');
    span.style.cssText = 'background:rgba(138,127,109,.28);color:inherit;border-radius:2px;padding:0 1px';
    span.textContent = node.nodeValue;
    node.parentNode.replaceChild(span, node);
  });
  return hits.length;
};
console.log('高亮', mark(document.body), '处');`,
    note: '没有现成的动作，已生成通用高亮代码，可直接改。',
  };
}

export const SNIPPETS = [
  { label: '隐藏广告', q: '隐藏广告和弹窗' },
  { label: '正文放大', q: '把正文放大一点' },
  { label: '夜间模式', q: '开启夜间模式' },
  { label: '提取链接', q: '提取所有链接' },
  { label: '页面大纲', q: '输出页面大纲' },
];
