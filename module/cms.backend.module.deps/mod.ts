// deno-lint-ignore-file no-explicit-any
import { backend } from "../cms.backend/mod.ts";
import type { Node } from "../cms/lib/Node.ts";
import type { App } from "../core/server.ts";

export const name = "cms.backend.module.deps";
export const needs = ["cms.backend"];

export async function install({ app }: { app: App }): Promise<void> {
  const P = await backend.install(app, "cms.backend.module.deps");
  if (P) {
    await P.title("en", "Module Dependencies");
    await P.title("de", "Modul-Abhängigkeiten");
  }
}

async function render(node: Node): Promise<string> {
  const app = node.app;
  const allMods = app.modules.all();

  const nodes: { id: string }[] = [];
  const links: { source: string; target: string }[] = [];

  for (const [name, mod] of Object.entries(allMods)) {
    nodes.push({ id: name });
    for (const dep of mod.exports.needs ?? []) {
      links.push({ source: dep, target: name });
    }
  }

  const graphData = JSON.stringify({ nodes, links });

  return `<div class=u2-card>
  <div class=-head>Modul-Abhängigkeiten</div>
  <div class=-body style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
    <input type=search id=mod-deps-search placeholder="filtern..." style="width:220px">
    <label style="display:flex;align-items:center;gap:4px">
      <input type=checkbox id=mod-deps-isolate> nur verbundene zeigen
    </label>
    <button onclick="modDepsReset()" style="margin-left:auto">Reset</button>
  </div>
  <div id=mod-deps-wrap style="overflow:hidden;position:relative">
    <svg id=mod-deps-svg style="width:100%;height:70vh;display:block;background:#f8f9fa;border-top:1px solid #ddd"></svg>
  </div>
  <div id=mod-deps-tooltip style="position:fixed;background:#222;color:#fff;padding:4px 8px;border-radius:4px;font-size:12px;pointer-events:none;display:none;z-index:9999"></div>
</div>
<script>
(function(){
  const DATA = ${graphData};

  const svg = document.getElementById('mod-deps-svg');
  const NS = 'http://www.w3.org/2000/svg';
  const tooltip = document.getElementById('mod-deps-tooltip');

  let W, H, nodes, links, filter = '', isolate = false;
  let dragging = null, dragOffX = 0, dragOffY = 0;
  let panX = 0, panY = 0, scale = 1;
  let panning = false, panStartX = 0, panStartY = 0, panOriginX = 0, panOriginY = 0;

  // Group colours by prefix
  function groupColor(id) {
    const parts = id.split('.');
    const prefix = parts.slice(0, 2).join('.');
    const palette = [
      '#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f',
      '#edc948','#b07aa1','#ff9da7','#9c755f','#bab0ac'
    ];
    let h = 0;
    for (let i = 0; i < prefix.length; i++) h = (h * 31 + prefix.charCodeAt(i)) & 0xffff;
    return palette[h % palette.length];
  }

  function init() {
    W = svg.clientWidth || 900;
    H = svg.clientHeight || 500;

    nodes = DATA.nodes.map(n => ({
      ...n,
      x: W / 2 + (Math.random() - .5) * W * .6,
      y: H / 2 + (Math.random() - .5) * H * .6,
      vx: 0, vy: 0,
    }));
    links = DATA.links.map(l => ({ ...l }));
    simulate(300);
    draw();
  }

  function visible(n) {
    if (!filter) return true;
    if (isolate) {
      return n.id.toLowerCase().includes(filter) ||
        links.some(l => (l.source === n.id || l.target === n.id) &&
          (l.source.toLowerCase().includes(filter) || l.target.toLowerCase().includes(filter)));
    }
    return n.id.toLowerCase().includes(filter);
  }

  function simulate(steps) {
    const idx = {};
    nodes.forEach((n, i) => idx[n.id] = i);
    for (let s = 0; s < steps; s++) {
      const alpha = 1 - s / steps;
      // repulsion
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          let dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const f = (120 * 120) / (d * d) * alpha;
          a.vx -= dx / d * f; a.vy -= dy / d * f;
          b.vx += dx / d * f; b.vy += dy / d * f;
        }
      }
      // attraction
      for (const l of links) {
        const a = nodes[idx[l.source]], b = nodes[idx[l.target]];
        if (!a || !b) continue;
        let dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - 140) * 0.06 * alpha;
        a.vx += dx / d * f; a.vy += dy / d * f;
        b.vx -= dx / d * f; b.vy -= dy / d * f;
      }
      // gravity to center
      for (const n of nodes) {
        n.vx += (W / 2 - n.x) * 0.01 * alpha;
        n.vy += (H / 2 - n.y) * 0.01 * alpha;
        n.x += n.vx * 0.6; n.y += n.vy * 0.6;
        n.vx *= 0.7; n.vy *= 0.7;
      }
    }
  }

  function draw() {
    svg.innerHTML = '';
    const defs = document.createElementNS(NS, 'defs');
    const marker = document.createElementNS(NS, 'marker');
    marker.setAttribute('id', 'arrow');
    marker.setAttribute('markerWidth', '8');
    marker.setAttribute('markerHeight', '8');
    marker.setAttribute('refX', '14');
    marker.setAttribute('refY', '3');
    marker.setAttribute('orient', 'auto');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M0,0 L0,6 L8,3 z');
    path.setAttribute('fill', '#999');
    marker.appendChild(path);
    defs.appendChild(marker);
    svg.appendChild(defs);

    const g = document.createElementNS(NS, 'g');
    g.setAttribute('id', 'mod-deps-g');
    g.setAttribute('transform', \`translate(\${panX},\${panY}) scale(\${scale})\`);
    svg.appendChild(g);

    const idx = {};
    nodes.forEach((n, i) => idx[n.id] = i);

    const visSet = new Set(nodes.filter(visible).map(n => n.id));

    // edges
    for (const l of links) {
      if (!visSet.has(l.source) || !visSet.has(l.target)) continue;
      const a = nodes[idx[l.source]], b = nodes[idx[l.target]];
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
      line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
      line.setAttribute('stroke', '#bbb');
      line.setAttribute('stroke-width', '1.5');
      line.setAttribute('marker-end', 'url(#arrow)');
      g.appendChild(line);
    }

    // nodes
    for (const n of nodes) {
      if (!visSet.has(n.id)) continue;
      const grp = document.createElementNS(NS, 'g');
      grp.setAttribute('transform', \`translate(\${n.x},\${n.y})\`);
      grp.style.cursor = 'grab';

      const label = n.id;
      const rx = label.length * 4 + 10;
      const ry = 12;

      const rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('x', -rx); rect.setAttribute('y', -ry);
      rect.setAttribute('width', rx * 2); rect.setAttribute('height', ry * 2);
      rect.setAttribute('rx', 6); rect.setAttribute('ry', 6);
      rect.setAttribute('fill', groupColor(n.id));
      rect.setAttribute('stroke', '#fff');
      rect.setAttribute('stroke-width', '1.5');
      grp.appendChild(rect);

      const text = document.createElementNS(NS, 'text');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'central');
      text.setAttribute('fill', '#fff');
      text.setAttribute('font-size', '11');
      text.setAttribute('font-family', 'monospace');
      text.setAttribute('pointer-events', 'none');
      text.textContent = label;
      grp.appendChild(text);

      grp.addEventListener('mousedown', e => startDrag(e, n));
      grp.addEventListener('mouseenter', e => showTooltip(e, n, idx));
      grp.addEventListener('mouseleave', hideTooltip);

      g.appendChild(grp);
    }
  }

  function showTooltip(e, n, idx) {
    const depCount = links.filter(l => l.target === n.id).length;
    const usedByCount = links.filter(l => l.source === n.id).length;
    tooltip.textContent = n.id + ' · needs: ' + depCount + ' · needed by: ' + usedByCount;
    tooltip.style.display = 'block';
    moveTooltip(e);
  }
  function moveTooltip(e) {
    tooltip.style.left = (e.clientX + 12) + 'px';
    tooltip.style.top = (e.clientY - 28) + 'px';
  }
  function hideTooltip() { tooltip.style.display = 'none'; }

  function startDrag(e, n) {
    if (e.button !== 0) return;
    e.stopPropagation();
    dragging = n;
    const pt = svgPoint(e);
    dragOffX = pt.x - n.x;
    dragOffY = pt.y - n.y;
    svg.style.cursor = 'grabbing';
  }

  function svgPoint(e) {
    return { x: (e.clientX - svg.getBoundingClientRect().left - panX) / scale,
             y: (e.clientY - svg.getBoundingClientRect().top  - panY) / scale };
  }

  svg.addEventListener('mousedown', e => {
    if (e.button === 0 && !dragging) {
      panning = true;
      panStartX = e.clientX; panStartY = e.clientY;
      panOriginX = panX; panOriginY = panY;
      svg.style.cursor = 'move';
    }
  });

  window.addEventListener('mousemove', e => {
    if (dragging) {
      const pt = svgPoint(e);
      dragging.x = pt.x - dragOffX;
      dragging.y = pt.y - dragOffY;
      draw();
      moveTooltip(e);
    } else if (panning) {
      panX = panOriginX + (e.clientX - panStartX);
      panY = panOriginY + (e.clientY - panStartY);
      document.getElementById('mod-deps-g').setAttribute('transform', \`translate(\${panX},\${panY}) scale(\${scale})\`);
    }
  });

  window.addEventListener('mouseup', () => {
    dragging = null; panning = false;
    svg.style.cursor = '';
  });

  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    panX = mx - (mx - panX) * factor;
    panY = my - (my - panY) * factor;
    scale = Math.max(0.15, Math.min(4, scale * factor));
    document.getElementById('mod-deps-g').setAttribute('transform', \`translate(\${panX},\${panY}) scale(\${scale})\`);
  }, { passive: false });

  document.getElementById('mod-deps-search').addEventListener('input', function() {
    filter = this.value.trim().toLowerCase();
    draw();
  });

  document.getElementById('mod-deps-isolate').addEventListener('change', function() {
    isolate = this.checked;
    draw();
  });

  window.modDepsReset = function() {
    panX = 0; panY = 0; scale = 1;
    filter = ''; isolate = false;
    document.getElementById('mod-deps-search').value = '';
    document.getElementById('mod-deps-isolate').checked = false;
    init();
  };

  // wait for layout
  requestAnimationFrame(() => { requestAnimationFrame(init); });
})();
</script>`;
}

export const cms = {
  node: { render },
};
