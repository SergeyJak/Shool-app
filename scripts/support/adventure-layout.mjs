import assert from 'node:assert/strict';

// Measure the rendered descendants as well as the document. A fixed-height
// overflow:hidden wrapper must never turn an off-screen lesson into a pass.
export async function assertAdventureFits(page, label) {
  const details = await page.evaluate(() => {
    const root = document.querySelector('#game');
    const viewport = window.visualViewport;
    const bounds = { left: viewport?.offsetLeft || 0, top: viewport?.offsetTop || 0,
      right: (viewport?.offsetLeft || 0) + (viewport?.width || innerWidth),
      bottom: (viewport?.offsetTop || 0) + (viewport?.height || innerHeight) };
    const visible = node => {
      if (!node?.getClientRects().length || getComputedStyle(node).visibility === 'hidden') return false;
      for (let ancestor = node; ancestor; ancestor = ancestor.parentElement)
        if (Number(getComputedStyle(ancestor).opacity) === 0) return false;
      return true;
    };
    const name = node => node.id ? `#${node.id}` : `${node.tagName.toLowerCase()}.${String(node.className).trim().replaceAll(' ', '.')}`;
    const box = rect => ({ left: Math.round(rect.left * 10) / 10, top: Math.round(rect.top * 10) / 10,
      right: Math.round(rect.right * 10) / 10, bottom: Math.round(rect.bottom * 10) / 10 });
    const outside = rect => rect.left < bounds.left - 1 || rect.top < bounds.top - 1 || rect.right > bounds.right + 1 || rect.bottom > bounds.bottom + 1;
    const nodes = [...root.querySelectorAll('*')].filter(visible);
    const content = nodes.filter(node => node.matches('button,input,img,[role="img"],svg') || [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim()));
    const rects = content.flatMap(node => {
      const items = [{ node, rect: node.getBoundingClientRect(), text: false }];
      for (const child of node.childNodes) if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) {
        const range = document.createRange(); range.selectNodeContents(child);
        items.push(...[...range.getClientRects()].map(rect => ({ node, rect, text: true })));
      }
      return items;
    });
    const offscreen = rects.flatMap(({node,rect,text}) => outside(rect) ? [{ node: name(node), text, ...box(rect) }] : []);
    const clipped = [];
    for (const {node,rect,text} of rects) {
      for (let parent = text ? node : node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const style = getComputedStyle(parent), area = parent.getBoundingClientRect();
        if ((/hidden|clip|auto|scroll/.test(style.overflowX) && (rect.left < area.left - 1 || rect.right > area.right + 1)) ||
            (/hidden|clip|auto|scroll/.test(style.overflowY) && (rect.top < area.top - 1 || rect.bottom > area.bottom + 1))) {
          clipped.push({ node: name(node), by: name(parent), ...box(rect) }); break;
        }
      }
    }
    const scrollContainers = [root, ...nodes].filter(node => {
      const style = getComputedStyle(node);
      return (/auto|scroll/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) ||
        (/auto|scroll/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1);
    }).map(name);
    const controls = nodes.filter(node => node.matches('button,input') && !node.disabled);
    const tooSmall = controls.flatMap(node => {
      const rect = node.getBoundingClientRect();
      // Dense spatial boards retain a 24px target; general controls need 32px.
      const minimum = node.matches('.ag-cell,.ag-coordinate-cell,.ag-calendar-day') ? 24 : 32;
      return rect.width < minimum - 1 || rect.height < minimum - 1 ? [{ node: name(node), width: rect.width, height: rect.height, minimum }] : [];
    });
    const overlaps = [];
    for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i].getBoundingClientRect(), b = controls[j].getBoundingClientRect();
      if (Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)
        overlaps.push([name(controls[i]),name(controls[j])]);
    }
    const next = document.querySelector('#next');
    if (visible(next)) for (const selector of ['#feedback','.ag-tools','#choices']) {
      const node = document.querySelector(selector); if (!node || !visible(node)) continue;
      const a = next.getBoundingClientRect(), b = node.getBoundingClientRect();
      if (Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1) overlaps.push(['#next',selector]);
    }
    const documentSize = { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight };
    return { viewport: bounds, document: documentSize, scroll: { x: scrollX, y: scrollY },
      offscreen: offscreen.slice(0,12), clipped: clipped.slice(0,12), scrollContainers, tooSmall: tooSmall.slice(0,12), overlaps: overlaps.slice(0,12) };
  });
  assert.ok(details.document.width <= details.viewport.right + 1 && details.document.height <= details.viewport.bottom + 1 &&
    !details.scroll.x && !details.scroll.y && !details.offscreen.length && !details.clipped.length && !details.scrollContainers.length && !details.tooSmall.length && !details.overlaps.length,
  `${label}: lesson must fit without scrolling, clipping or overlapping controls: ${JSON.stringify(details)}`);
}
