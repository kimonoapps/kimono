/*
 * Kimono's artifact kit (docs/kimono-ai.md, "Artifacts"). Loaded into every
 * artifact before its own markup, so an artifact is mostly tags:
 *
 *   <k-chart type="line" x="month" y="rent,food" data='[{"month":"Jan","rent":900,"food":320}]'>
 *   <k-stat label="Spent" value="$1,220" delta="+4%">
 *   <k-grid cols="3">, <k-card title="…">, <k-row>
 *   <k-table data='[…]'>, <k-tabs><k-tab label="…">, <k-slider name="rate" min max step value>
 *   <k-progress value max label>, <k-callout tone="good|warn">
 *   <k-scene height="380"><script type="text/kimono-scene"> …one statement per line… </script></k-scene>
 *
 * Everything a component needs is in its start tag, so it draws the moment it
 * is written, while the rest of the artifact is still arriving. A scene runs
 * line by line as it arrives, and plays again whenever the person asks.
 *
 * window.K: K.value(name), K.watch(name, fn), K.colors(), K.format(n, opts).
 */
(() => {
  "use strict";
  if (window.K) return;
  const K = window.K = {};
  const SVG = "http://www.w3.org/2000/svg";
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const series = () => [1, 2, 3, 4, 5, 6, 7].map((i) => css(`--k-s${i}`) || "#a84d63");
  const named = { suo: "--k-s1", indigo: "--k-s2", blue: "--k-s2", moss: "--k-s3", green: "--k-s3", amber: "--k-s4", gold: "--k-s4", plum: "--k-s5", purple: "--k-s5", teal: "--k-s6", rust: "--k-s7", orange: "--k-s7", ink: "--k-ink", soft: "--k-soft", accent: "--k-accent", red: "--k-bad" };
  const colour = (c, i = 0) => !c ? series()[i % 7] : named[c] ? css(named[c]) : c;
  K.colors = series;
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const json = (text, fallback) => { if (text == null || text === "") return fallback; try { return JSON.parse(text); } catch { return fallback; } };
  const el = (tag, attrs = {}, parent) => {
    const node = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  };
  const html = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  /* numbers */
  K.format = (n, opts = {}) => {
    if (typeof n !== "number" || !isFinite(n)) return String(n ?? "");
    const abs = Math.abs(n);
    const short = opts.short !== false && abs >= 10000;
    const text = short
      ? new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n)
      : new Intl.NumberFormat(undefined, { maximumFractionDigits: opts.digits ?? (abs < 10 && n % 1 ? 2 : abs < 100 && n % 1 ? 1 : 0) }).format(n);
    return `${opts.prefix ?? ""}${text}${opts.suffix ?? ""}`;
  };
  function niceTicks(min, max, count = 5) {
    if (!isFinite(min) || !isFinite(max)) return [0, 1];
    if (min === max) { min -= 1; max += 1; }
    const span = max - min, raw = span / count, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag;
    const out = [];
    for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-6; v += step) out.push(+v.toFixed(10));
    return out;
  }
  K.ticks = niceTicks;

  /* shared values: sliders and anything else that names one */
  const values = {}, watchers = {};
  K.value = (name) => values[name];
  K.set = (name, v) => { values[name] = v; for (const fn of watchers[name] ?? []) { try { fn(v); } catch (e) { console.error(e); } } };
  K.watch = (name, fn) => { (watchers[name] ??= []).push(fn); if (name in values) fn(values[name]); };

  /* every component draws on connect and again when an attribute changes or its box resizes */
  class Base extends HTMLElement {
    connectedCallback() {
      if (!this._seen) { this._seen = true; this.setup?.(); }
      this.schedule();
      if (this.resizes && !this._ro) { let w = 0; this._ro = new ResizeObserver(() => { const n = this.clientWidth; if (n && Math.abs(n - w) > 2) { w = n; this.schedule(true); } }); this._ro.observe(this); }
    }
    disconnectedCallback() { this._ro?.disconnect(); this._ro = null; }
    attributeChangedCallback() { if (this._seen) this.schedule(); }
    schedule(quiet) { if (this._raf) return; this._raf = requestAnimationFrame(() => { this._raf = 0; try { this.render(quiet); } catch (e) { console.error(e); } }); }
  }

  /* ── k-chart ── */
  class Chart extends Base {
    static observedAttributes = ["data", "type", "x", "y", "title", "height", "stacked", "colors", "prefix", "suffix", "labels", "min", "max"];
    get resizes() { return true; }
    render(quiet) {
      const type = (this.getAttribute("type") || "line").toLowerCase();
      let data = json(this.getAttribute("data"), []);
      if (!Array.isArray(data)) data = [];
      const prefix = this.getAttribute("prefix") ?? "", suffix = this.getAttribute("suffix") ?? "";
      const fmt = (v) => K.format(v, { prefix, suffix });
      /* rows may be objects or [x, y…] arrays */
      let xKey = this.getAttribute("x"), yKeys = (this.getAttribute("y") || "").split(",").map((s) => s.trim()).filter(Boolean);
      if (data.length && Array.isArray(data[0])) {
        const width = data[0].length;
        data = data.map((row) => Object.fromEntries(row.map((v, i) => [i === 0 ? "x" : `y${i}`, v])));
        xKey = "x"; if (!yKeys.length) yKeys = Array.from({ length: width - 1 }, (_, i) => `y${i + 1}`);
      }
      if (data.length && !xKey) xKey = Object.keys(data[0]).find((k) => typeof data[0][k] !== "number") ?? Object.keys(data[0])[0];
      if (data.length && !yKeys.length) yKeys = Object.keys(data[0]).filter((k) => k !== xKey && typeof data[0][k] === "number");
      const labels = (this.getAttribute("labels") || "").split(",").map((s) => s.trim());
      const nameOf = (k, i) => labels[i] || k;
      const colors = (this.getAttribute("colors") || "").split(",").map((s) => s.trim()).filter(Boolean);
      const col = (i) => colour(colors[i], i);
      const width = Math.max(240, this.clientWidth || 480);
      const height = +(this.getAttribute("height") || (type === "pie" || type === "donut" ? 260 : 280));
      this.replaceChildren();
      const title = this.getAttribute("title");
      if (title) this.append(html("div", "k-chart-title", title));
      const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, height, role: "img", "aria-label": title || `${type} chart` });
      this.append(svg);
      const tip = html("div", "k-tip"); this.append(tip);
      const show = (event, text) => { const box = this.getBoundingClientRect(); tip.textContent = text; tip.style.left = `${Math.min(box.width - 140, Math.max(0, event.clientX - box.left + 12))}px`; tip.style.top = `${event.clientY - box.top - 34}px`; tip.style.opacity = 1; };
      const hide = () => { tip.style.opacity = 0; };
      const ink = css("--k-ink"), soft = css("--k-soft"), line = css("--k-line"), page = css("--k-page");
      const animate = !quiet && !reduced();
      if (!data.length) { el("text", { x: width / 2, y: height / 2, "text-anchor": "middle", fill: soft, "font-size": 13 }, svg).textContent = "No data yet"; return; }

      if (type === "pie" || type === "donut") {
        const key = yKeys[0];
        const total = data.reduce((s, r) => s + (+r[key] || 0), 0) || 1;
        const r = Math.min(height / 2 - 8, width / 2 - 8), cx = width / 2, cy = height / 2, inner = type === "donut" ? r * .58 : 0;
        let a0 = -Math.PI / 2;
        data.forEach((row, i) => {
          const v = +row[key] || 0, a1 = a0 + v / total * Math.PI * 2, large = a1 - a0 > Math.PI ? 1 : 0;
          const p = (a, rad) => `${cx + rad * Math.cos(a)} ${cy + rad * Math.sin(a)}`;
          const d = inner
            ? `M${p(a0, r)} A${r} ${r} 0 ${large} 1 ${p(a1, r)} L${p(a1, inner)} A${inner} ${inner} 0 ${large} 0 ${p(a0, inner)}Z`
            : `M${cx} ${cy} L${p(a0, r)} A${r} ${r} 0 ${large} 1 ${p(a1, r)}Z`;
          const slice = el("path", { d, fill: col(i), stroke: page, "stroke-width": 2, class: animate ? "k-pop" : null, style: animate ? `animation-delay:${i * 60}ms` : null }, svg);
          slice.addEventListener("pointermove", (e) => show(e, `${row[xKey]}: ${fmt(v)} (${Math.round(v / total * 100)}%)`));
          slice.addEventListener("pointerleave", hide);
          a0 = a1;
        });
        if (inner) { el("text", { x: cx, y: cy + 8, "text-anchor": "middle", fill: ink, "font-size": 22, "font-weight": 700, "font-family": css("--k-display") }, svg).textContent = fmt(total); }
        const legend = html("div", "k-legend");
        data.forEach((row, i) => { const item = html("span"); const dot = html("i"); dot.style.background = col(i); item.append(dot, `${row[xKey]}`); legend.append(item); });
        this.append(legend);
        return;
      }

      const horizontal = type === "hbar";
      const bars = type === "bar" || horizontal;
      const stacked = this.hasAttribute("stacked");
      const xs = data.map((r) => r[xKey]);
      const numericX = !bars && xs.every((v) => typeof v === "number");
      let lo = Infinity, hi = -Infinity;
      data.forEach((r) => {
        if (stacked) { let pos = 0, neg = 0; yKeys.forEach((k) => { const v = +r[k] || 0; v >= 0 ? pos += v : neg += v; }); lo = Math.min(lo, neg); hi = Math.max(hi, pos); }
        else yKeys.forEach((k) => { const v = +r[k]; if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
      });
      if (bars || type === "area") lo = Math.min(0, lo);
      if (this.hasAttribute("min")) lo = +this.getAttribute("min");
      if (this.hasAttribute("max")) hi = +this.getAttribute("max");
      const ticks = niceTicks(lo, hi, horizontal ? 4 : 5);
      lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
      const tickWidth = Math.max(...ticks.map((t) => fmt(t).length)) * 7 + 10;
      const catWidth = horizontal ? Math.min(140, Math.max(...xs.map((v) => String(v).length)) * 7 + 12) : 0;
      const m = { l: horizontal ? catWidth : tickWidth, r: 12, t: 10, b: horizontal ? 24 : 28 };
      const W = width - m.l - m.r, H = height - m.t - m.b;
      const scaleV = (v) => horizontal ? m.l + (v - lo) / (hi - lo || 1) * W : m.t + H - (v - lo) / (hi - lo || 1) * H;
      const xMin = numericX ? Math.min(...xs) : 0, xMax = numericX ? Math.max(...xs) : 0;
      const band = (horizontal ? H : W) / data.length;
      const pos = (i) => numericX ? m.l + (xs[i] - xMin) / (xMax - xMin || 1) * W : (horizontal ? m.t : m.l) + band * (i + .5);
      /* grid and value axis */
      ticks.forEach((t) => {
        const v = scaleV(t);
        if (horizontal) { el("line", { x1: v, x2: v, y1: m.t, y2: m.t + H, stroke: line }, svg); el("text", { x: v, y: height - 6, "text-anchor": "middle", fill: soft, "font-size": 11 }, svg).textContent = fmt(t); }
        else { el("line", { x1: m.l, x2: m.l + W, y1: v, y2: v, stroke: line }, svg); el("text", { x: m.l - 8, y: v + 4, "text-anchor": "end", fill: soft, "font-size": 11 }, svg).textContent = fmt(t); }
      });
      /* category axis: as many labels as fit */
      const every = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor((horizontal ? H / 18 : W / 64)))));
      xs.forEach((x, i) => {
        if (i % every) return;
        if (horizontal) el("text", { x: m.l - 8, y: pos(i) + 4, "text-anchor": "end", fill: soft, "font-size": 11 }, svg).textContent = String(x);
        else el("text", { x: pos(i), y: height - 8, "text-anchor": "middle", fill: soft, "font-size": 11 }, svg).textContent = String(x);
      });
      if (bars) {
        const groups = stacked ? 1 : yKeys.length;
        const inner = band * .72, each = inner / groups;
        data.forEach((row, i) => {
          let up = 0, down = 0;
          yKeys.forEach((k, j) => {
            const v = +row[k] || 0;
            let a, b;
            if (stacked) { if (v >= 0) { a = up; b = up + v; up = b; } else { a = down; b = down + v; down = b; } }
            else { a = 0; b = v; }
            const p0 = scaleV(Math.max(lo, Math.min(a, b))), p1 = scaleV(Math.max(a, b));
            const off = pos(i) - inner / 2 + (stacked ? 0 : each * j);
            const thick = Math.max(1, (stacked ? inner : each) - 2);
            const rect = horizontal
              ? el("rect", { x: Math.min(p0, p1), y: off, width: Math.abs(p1 - p0), height: thick, rx: 4, fill: col(j), class: animate ? "k-grow-x" : null }, svg)
              : el("rect", { x: off, y: Math.min(p0, p1), width: thick, height: Math.abs(p1 - p0), rx: 4, fill: col(j), class: animate ? "k-grow" : null }, svg);
            if (animate) rect.style.animationDelay = `${i * 40}ms`;
            rect.addEventListener("pointermove", (e) => show(e, `${row[xKey]} · ${nameOf(k, j)}: ${fmt(v)}`));
            rect.addEventListener("pointerleave", hide);
          });
        });
      } else {
        const baseline = scaleV(Math.max(lo, 0));
        yKeys.forEach((k, j) => {
          const pts = data.map((r, i) => [pos(i), scaleV(+r[k])]).filter((p) => isFinite(p[1]));
          if (!pts.length) return;
          const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("");
          if (type === "area") el("path", { d: `${d}L${pts[pts.length - 1][0]} ${baseline}L${pts[0][0]} ${baseline}Z`, fill: col(j), opacity: .16, class: animate ? "k-fade" : null }, svg);
          if (type !== "scatter") {
            const path = el("path", { d, fill: "none", stroke: col(j), "stroke-width": 2.5, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
            if (animate) { const len = path.getTotalLength(); path.style.cssText = `--len:${len};stroke-dasharray:${len};animation-delay:${j * 120}ms`; path.classList.add("k-draw"); }
          }
          pts.forEach((p, i) => {
            const dot = el("circle", { cx: p[0], cy: p[1], r: type === "scatter" ? 4.5 : data.length > 40 ? 0 : 3, fill: col(j), class: animate ? "k-pop" : null }, svg);
            if (animate) dot.style.animationDelay = `${300 + i * 15}ms`;
          });
        });
        /* hover: the nearest x, every series */
        const hit = el("rect", { x: m.l, y: m.t, width: W, height: H, fill: "transparent" }, svg);
        const guide = el("line", { y1: m.t, y2: m.t + H, stroke: soft, "stroke-dasharray": "3 3", opacity: 0 }, svg);
        hit.addEventListener("pointermove", (e) => {
          const box = svg.getBoundingClientRect(), x = (e.clientX - box.left) / box.width * width;
          let best = 0; data.forEach((_, i) => { if (Math.abs(pos(i) - x) < Math.abs(pos(best) - x)) best = i; });
          guide.setAttribute("x1", pos(best)); guide.setAttribute("x2", pos(best)); guide.setAttribute("opacity", .6);
          show(e, `${xs[best]} · ${yKeys.map((k, j) => `${nameOf(k, j)} ${fmt(+data[best][k])}`).join(" · ")}`);
        });
        hit.addEventListener("pointerleave", () => { hide(); guide.setAttribute("opacity", 0); });
      }
      if (yKeys.length > 1) {
        const legend = html("div", "k-legend");
        yKeys.forEach((k, j) => { const item = html("span"); const dot = html("i"); dot.style.background = col(j); item.append(dot, nameOf(k, j)); legend.append(item); });
        this.append(legend);
      }
    }
  }

  /* ── k-stat ── */
  class Stat extends Base {
    static observedAttributes = ["label", "value", "delta", "note"];
    render() {
      this.replaceChildren();
      const label = this.getAttribute("label"), delta = this.getAttribute("delta"), note = this.getAttribute("note");
      if (label) this.append(html("span", "k-label", label));
      this.append(html("span", "k-value", this.getAttribute("value") ?? ""));
      if (delta) this.append(html("span", `k-delta ${/^\s*[-−–]/.test(delta) ? "down" : /^\s*\+/.test(delta) ? "up" : ""}`, delta));
      if (note) this.append(html("span", "k-note", note));
    }
  }

  /* ── k-grid, k-card ── */
  class Grid extends Base {
    static observedAttributes = ["cols"];
    render() { this.style.setProperty("--cols", this.getAttribute("cols") || "2"); }
  }
  class Card extends Base {
    static observedAttributes = ["title"];
    render() {
      const title = this.getAttribute("title");
      let head = this.querySelector(":scope > .k-card-title");
      if (title && !head) { head = html("div", "k-card-title"); this.prepend(head); }
      if (head) head.textContent = title ?? "";
    }
  }

  /* ── k-table ── */
  class Table extends Base {
    static observedAttributes = ["data", "columns"];
    render() {
      const data = json(this.getAttribute("data"), []);
      if (!Array.isArray(data) || !data.length) return;
      const cols = (this.getAttribute("columns") || "").split(",").map((s) => s.trim()).filter(Boolean);
      const keys = cols.length ? cols : Object.keys(data[0]);
      const numeric = keys.map((k) => data.every((r) => r[k] == null || typeof r[k] === "number"));
      const table = html("table"), head = html("thead"), body = html("tbody"), tr = html("tr");
      let sortKey = null, dir = 1;
      keys.forEach((k, i) => {
        const th = html("th", numeric[i] ? "k-num" : "", k); th.dataset.sort = k; th.tabIndex = 0;
        const sort = () => { dir = sortKey === k ? -dir : 1; sortKey = k; fill(); tr.querySelectorAll("th").forEach((h) => h.removeAttribute("aria-sort")); th.setAttribute("aria-sort", dir > 0 ? "ascending" : "descending"); };
        th.addEventListener("click", sort); th.addEventListener("keydown", (e) => { if (e.key === "Enter") sort(); });
        tr.append(th);
      });
      head.append(tr);
      const fill = () => {
        const rows = sortKey ? [...data].sort((a, b) => (a[sortKey] > b[sortKey] ? 1 : a[sortKey] < b[sortKey] ? -1 : 0) * dir) : data;
        body.replaceChildren(...rows.map((r) => { const row = html("tr"); keys.forEach((k, i) => row.append(html("td", numeric[i] ? "k-num" : "", numeric[i] && typeof r[k] === "number" ? K.format(r[k], { short: false }) : r[k] ?? ""))); return row; }));
      };
      fill();
      table.append(head, body);
      this.replaceChildren(table);
    }
  }

  /* ── k-tabs ── */
  class Tabs extends Base {
    setup() { new MutationObserver(() => this.schedule()).observe(this, { childList: true }); }
    render() {
      const tabs = [...this.querySelectorAll(":scope > k-tab")];
      let list = this.querySelector(":scope > .k-tablist");
      if (!list) { list = html("div", "k-tablist"); list.setAttribute("role", "tablist"); this.prepend(list); }
      const current = Math.min(this._current ?? 0, Math.max(0, tabs.length - 1));
      list.replaceChildren(...tabs.map((tab, i) => {
        const b = html("button", "", tab.getAttribute("label") || `Tab ${i + 1}`);
        b.type = "button"; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", String(i === current));
        b.addEventListener("click", () => { this._current = i; this.render(); });
        return b;
      }));
      tabs.forEach((tab, i) => { tab.hidden = i !== current; });
    }
  }

  /* ── k-slider ── */
  class Slider extends Base {
    static observedAttributes = ["label", "min", "max", "step", "unit"];
    setup() {
      const name = this.getAttribute("name") || "value";
      const head = html("div", "k-slider-head"), label = html("label"), out = html("output");
      const input = html("input"); input.type = "range";
      head.append(label, out); this.append(head, input);
      const update = () => { const v = +input.value; out.textContent = K.format(v, { prefix: this.getAttribute("prefix") ?? "", suffix: this.getAttribute("unit") ?? "", short: false }); K.set(name, v); this.dispatchEvent(new CustomEvent("change", { detail: v, bubbles: true })); };
      input.addEventListener("input", update);
      this._parts = { label, input, update };
      input.min = this.getAttribute("min") ?? 0; input.max = this.getAttribute("max") ?? 100; input.step = this.getAttribute("step") ?? 1;
      input.value = this.getAttribute("value") ?? input.min;
      update();
    }
    render() {
      const { label, input, update } = this._parts;
      label.textContent = this.getAttribute("label") ?? this.getAttribute("name") ?? "";
      input.min = this.getAttribute("min") ?? 0; input.max = this.getAttribute("max") ?? 100; input.step = this.getAttribute("step") ?? 1;
      update();
    }
  }

  /* ── k-progress, k-callout ── */
  class Progress extends Base {
    static observedAttributes = ["value", "max", "label"];
    render() {
      const v = +(this.getAttribute("value") || 0), max = +(this.getAttribute("max") || 100);
      if (!this._bar) { this._label = html("span"); const bar = html("div", "k-bar"); this._bar = html("i"); bar.append(this._bar); this.append(this._label, bar); this.setAttribute("role", "progressbar"); }
      this._label.textContent = this.getAttribute("label") ?? `${Math.round(v / max * 100)}%`;
      this._bar.style.width = `${Math.max(0, Math.min(100, v / max * 100))}%`;
      this.setAttribute("aria-valuenow", String(v)); this.setAttribute("aria-valuemax", String(max));
    }
  }
  class Callout extends Base { render() {} }

  /* ── k-scene: an animation written as code, one statement per line ── */
  const ease = { linear: (p) => p, out: (p) => 1 - Math.pow(1 - p, 3), inOut: (p) => p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2, spring: (p) => 1 - Math.cos(p * Math.PI * 2.4) * Math.exp(-p * 6) };
  const clamp = (v) => Math.max(0, Math.min(1, v));
  let THREE = null, threeLoading = null;
  function loadThree() {
    if (THREE) return Promise.resolve(THREE);
    const base = KIT_BASE || ([...document.scripts].map((s) => s.src).find((s) => /\/ai\/lib\/kit\.js/.test(s)) || "").replace(/kit\.js.*$/, "");
    threeLoading ??= import(`${base}three/three.module.min.js`).then((m) => (THREE = m));
    return threeLoading;
  }
  const KIT_BASE = (document.currentScript?.src || "").replace(/kit\.js.*$/, "");

  class Scene extends Base {
    setup() {
      /* never taller than a scene needs to be: 200 to 520 */
      this.height = Math.max(200, Math.min(520, +(this.getAttribute("height") || 360)));
      /* Inside Kimono the controls are Kimono's, under the card; the scene only reports its time. */
      this.external = Boolean(window.KIMONO_FRAME);
      this.stage = html("div", "k-stage");
      this.canvas = html("canvas");
      /* words and formulas sit over the drawing as text, so they're crisp and can be typeset */
      this.overlay = html("div", "k-overlay");
      this.stage.append(this.canvas, this.overlay);
      /* what the person set by hand: sliders by name, dragged points by order; kept while the script grows */
      this.params = {}; this.drags = {}; this.turn = { az: 0, el: 0 };
      this.controls = html("div", "k-controls");
      this.playButton = html("button", "", "❚❚"); this.playButton.type = "button"; this.playButton.setAttribute("aria-label", "Pause");
      this.scrub = html("input"); this.scrub.type = "range"; this.scrub.min = 0; this.scrub.max = 1000; this.scrub.value = 0; this.scrub.setAttribute("aria-label", "Time");
      this.clock = html("span", "", "0.0s");
      this.state = html("span", "k-building", "");
      this.controls.append(this.playButton, this.scrub, this.clock, this.state);
      this.errorBox = html("div", "k-error"); this.errorBox.hidden = true;
      this.prepend(this.stage); if (!this.external) this.append(this.controls); this.append(this.errorBox);
      this.t = 0; this.playing = !reduced(); this.complete = false; this.timeline = null; this.source = ""; this.ran = "";
      this.playButton.addEventListener("click", () => this.toggle());
      this.pointer();
      this.scrub.addEventListener("input", () => { this.t = (+this.scrub.value / 1000) * (this.timeline?.end || 0); this.playing = false; this.paint(); });
      /* the script inside, as it grows */
      const script = this.querySelector("script");
      if (script) this.feed(script.textContent, false);
      new MutationObserver(() => { const s = this.querySelector("script"); if (s) this.feed(s.textContent, this._closed); }).observe(this, { childList: true, subtree: true, characterData: true });
      let last = performance.now();
      const tick = (now) => {
        if (!this.isConnected) { this._loop = 0; return; }
        const dt = Math.min(.1, (now - last) / 1000); last = now;
        if (this.playing && this.timeline) {
          const end = this.timeline.end;
          this.t = Math.min(this.t + dt, end);
          if (this.t >= end && this.complete) { this.playing = false; }
        }
        this.paint();
        if (this.external && now - (this._told || 0) > 90) { this._told = now; this.report(); }
        this._loop = requestAnimationFrame(tick);
      };
      this._loop = requestAnimationFrame(tick);
      document.addEventListener("DOMContentLoaded", () => { this._closed = true; const s = this.querySelector("script"); if (s) this.feed(s.textContent, true); });
    }
    get resizes() { return true; }
    render() { this.size(); }
    /* Press a point to drag it; drag anywhere else in 3D to turn the view; a tap plays or pauses. */
    pointer() {
      let action = null;
      const at = (e) => { const box = this.stage.getBoundingClientRect(); return [e.clientX - box.left, e.clientY - box.top]; };
      this.stage.addEventListener("pointerdown", (e) => {
        const [X, Y] = at(e), tl = this.timeline;
        const id = tl?.dragAt?.(X, Y, this.w, this.h);
        action = id != null ? { drag: id } : { X, Y, moved: false, az: this.turn.az, el: this.turn.el };
        this.stage.setPointerCapture(e.pointerId);
      });
      this.stage.addEventListener("pointermove", (e) => {
        const [X, Y] = at(e), tl = this.timeline;
        if (!action) { this.stage.style.cursor = tl?.dragAt?.(X, Y, this.w, this.h) != null ? "grab" : tl?.uses3d ? "move" : ""; return; }
        if (action.drag != null) { tl?.dragTo?.(action.drag, X, Y, this.w, this.h); this.report(true); return; }
        if (Math.hypot(X - action.X, Y - action.Y) > 4) action.moved = true;
        if (action.moved && tl?.uses3d) { this.turn.az = action.az - (X - action.X) * .4; this.turn.el = Math.max(-80, Math.min(80, action.el + (Y - action.Y) * .3)); }
      });
      const up = () => { if (action && action.drag == null && !action.moved) this.toggle(); action = null; };
      this.stage.addEventListener("pointerup", up);
      this.stage.addEventListener("pointercancel", () => { action = null; });
    }
    setParam(name, value) { if (this.timeline?.params.some((p) => p.name === name)) { this.params[name] = +value; this.report(true); } }
    /* The overlay's words: one element per label, moved each frame, rewritten only when its words change. */
    drawLabels(labels) {
      const seen = new Set();
      this._labels ??= new Map();
      for (const l of labels) {
        seen.add(l.key);
        let node = this._labels.get(l.key);
        if (!node) { node = html("div", `k-label k-label-${l.kind || "text"}`); this.overlay.append(node); this._labels.set(l.key, node); }
        const text = String(l.text ?? "");
        const katexReady = !/\$/.test(text) || Boolean(window.katex);
        if (node._text !== text || node._typeset !== katexReady) { node._text = text; node._typeset = katexReady; setRich(node, text); }
        node.style.opacity = String(l.alpha ?? 1);
        if (l.color) node.style.color = l.color; else node.style.removeProperty("color");
        if (l.size) node.style.fontSize = `${l.size}px`;
        if (l.kind !== "title" && l.kind !== "caption") {
          const ax = l.align === "left" ? "0%" : l.align === "right" ? "-100%" : "-50%";
          node.style.transform = `translate(${l.x.toFixed(1)}px, ${l.y.toFixed(1)}px) translate(${ax}, -50%)`;
        }
      }
      for (const [key, node] of this._labels) if (!seen.has(key)) { node.remove(); this._labels.delete(key); }
    }
    toggle() {
      if (!this.timeline) return;
      if (!this.playing && this.t >= this.timeline.end - 1e-3) this.t = 0;
      this.playing = !this.playing;
    }
    replay() {
      /* sliders the script moves itself go back to its own values; ones only the person moves stay */
      for (const p of this.timeline?.params ?? []) if (p.segs.length) delete this.params[p.name];
      this.t = 0; this.playing = true;
    }
    play() { if (this.timeline && this.t >= this.timeline.end - 1e-3 && this.complete) this.t = 0; this.playing = true; }
    pause() { this.playing = false; }
    seek(t) { this.t = Math.max(0, Math.min(t, this.timeline?.end || 0)); this.playing = false; this.paint(); }
    report() {
      if (!this.external) return;
      const index = [...document.querySelectorAll("k-scene")].indexOf(this);
      const end = this.timeline?.end || 0;
      const params = (this.timeline?.params ?? []).map((p) => ({ name: p.name, label: p.label, min: p.min, max: p.max, step: p.step, value: p.v, unit: p.unit }));
      const state = { kimono: "scene", index, t: this.t, end, playing: this.playing && !(this.t >= end && this.complete), complete: this.complete, params };
      /* only when something moved: a paused scene says nothing */
      const key = `${index}|${state.t.toFixed(2)}|${end}|${state.playing}|${state.complete}|${params.map((p) => `${p.name}=${p.value}`).join(",")}`;
      if (key === this._said) return;
      this._said = key;
      parent.postMessage(state, "*");
    }
    /* The host page hands over the script as it streams (it reads the raw text, so nothing depends on the parser). */
    feed(text, complete) {
      if (text === this.source && complete === this.complete) return;
      this.source = text; this.complete = !!complete;
      const lines = text.split("\n");
      if (!complete) lines.pop();
      let take = lines.length;
      /* a statement still being written keeps its lines back until it parses */
      for (; take > 0 && take >= lines.length - 12; take--) {
        const code = lines.slice(0, take).join("\n");
        if (code === this.ran) { this.state.textContent = complete ? "" : "Writing…"; return; }
        try { new Function(code); } catch { continue; }
        this.run(code);
        break;
      }
      this.state.textContent = complete ? "" : "Writing…";
    }
    run(code) {
      const timeline = makeTimeline(this);
      /* the same script draws the same thing every time: randomness repeats within a scene */
      const random = Math.random;
      Math.random = seeded(7);
      try {
        new Function(...Object.keys(timeline.api), `"use strict";\n${code}`)(...Object.values(timeline.api));
        this.errorBox.hidden = true;
      } catch (error) {
        this.errorBox.hidden = false; this.errorBox.textContent = String(error?.message || error);
        if (this.timeline) return;
      } finally { Math.random = random; }
      if (timeline.usesTex) loadKatex();
      this.ran = code;
      const was3d = this.timeline?.three;
      this.timeline?.dispose?.();
      this.timeline = timeline;
      if (timeline.uses3d) this.ensure3d(); else if (was3d) this.drop3d();
      if (!this.complete && !reduced()) this.playing = true;
      this.size();
    }
    ensure3d() {
      if (this.gl) { this.timeline.mount3d(); return; }
      loadThree().then((T) => {
        if (this.gl || !this.isConnected) return;
        const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(2, devicePixelRatio));
        this.stage.prepend(renderer.domElement);
        renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
        this.canvas.style.position = "relative";
        const camera = new T.PerspectiveCamera(40, 1, .1, 1000);
        this.gl = { renderer, camera, scene: new T.Scene() };
        this.size();
        this.timeline?.mount3d();
      }, (error) => { this.errorBox.hidden = false; this.errorBox.textContent = `3D couldn't load: ${error?.message || error}`; });
    }
    drop3d() { if (!this.gl) return; this.gl.renderer.domElement.remove(); this.gl.renderer.dispose(); this.gl = null; }
    size() {
      const w = Math.max(200, this.clientWidth || 600), h = this.height, dpr = Math.min(2, devicePixelRatio || 1);
      this.w = w; this.h = h;
      this.stage.style.height = `${h}px`;
      if (this.canvas.width !== Math.round(w * dpr)) { this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr); this.canvas.style.height = `${h}px`; }
      this.dpr = dpr;
      if (this.gl) { this.gl.renderer.setSize(w, h, false); this.gl.camera.aspect = w / h; this.gl.camera.updateProjectionMatrix(); }
    }
    paint() {
      const tl = this.timeline;
      const end = tl?.end || 0;
      this.scrub.value = end ? String(Math.round(this.t / end * 1000)) : "0";
      this.clock.textContent = `${this.t.toFixed(1)}s`;
      const playingNow = this.playing && !(this.t >= end && this.complete);
      this.playButton.textContent = playingNow ? "❚❚" : this.t >= end - 1e-3 && this.complete ? "↻" : "▶";
      this.playButton.setAttribute("aria-label", playingNow ? "Pause" : this.t >= end - 1e-3 && this.complete ? "Play again" : "Play");
      const ctx = this.canvas.getContext("2d");
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.w, this.h);
      if (!tl) return;
      tl.paint(ctx, this.t, this.w, this.h);
      if (this.gl && tl.uses3d) tl.paint3d(this.gl, this.t, this.w, this.h);
      this.drawLabels(tl.labels);
    }
  }

  /* The scene's vocabulary. Each call adds a step at the timeline's cursor; wait() moves it on. */
  function makeTimeline(host) {
    const ops = [], trackers = [];
    let cursor = 0, group = null, view = { x: [-1, 1], y: [-1, 1], set: false }, now = 0, end = 0;
    const tl = { ops, end: 0, uses3d: false, three: null, params: [], labels: [], drags: [] };
    const stretch = (t) => { end = Math.max(end, t); tl.end = end; };
    const add = (op, d = .8) => {
      op.t0 = group ? group.start : cursor; op.d = Math.max(0, d);
      ops.push(op); stretch(op.t0 + op.d);
      if (group) group.longest = Math.max(group.longest, op.d); else cursor += op.d;
      return handle(op);
    };
    const handle = (op) => ({
      fade(d = .5) { op.fadeAt = group ? group.start : cursor; op.fadeD = d; if (group) group.longest = Math.max(group.longest, d); else cursor += d; stretch(op.fadeAt + d); return this; },
      op,
    });
    const value = (v) => typeof v === "function" ? v() : v;
    const col = (o, i) => colour(o?.color, i);
    const top = () => tl.titled ? 48 : 20, bottom = () => tl.captioned ? 66 : 34;
    const sx = (x, w) => 56 + (x - view.x[0]) / (view.x[1] - view.x[0]) * (w - 56 - 20);
    const sy = (y, h) => top() + (1 - (y - view.y[0]) / (view.y[1] - view.y[0])) * (h - top() - bottom());
    const ux = (X, w) => view.x[0] + (X - 56) / (w - 76) * (view.x[1] - view.x[0]);
    const uy = (Y, h) => view.y[0] + (1 - (Y - top()) / (h - top() - bottom())) * (view.y[1] - view.y[0]);
    /* a label over the drawing (crisp text, and $…$ typeset as maths) */
    const say = (key, kind, x, y, text, o = {}) => { tl.labels.push({ key, kind, x, y, text, ...o }); if (/\$/.test(String(text))) tl.usesTex = true; };
    let labelId = 0;
    const font = (size, weight = 600, family = "--k-sans") => `${weight} ${size}px ${css(family)}`;
    let seriesIndex = 0;

    const api = {
      /* time */
      wait(s = .5) { if (group) group.longest = Math.max(group.longest, s); else cursor += s; stretch(cursor); },
      together(fn) { const outer = group; group = { start: outer ? outer.start : cursor, longest: 0 }; try { fn(); } finally { const g = group; group = outer; if (outer) outer.longest = Math.max(outer.longest, g.longest); else cursor = g.start + g.longest; stretch(g.start + g.longest); } },
      tracker(v = 0) {
        const tr = { segs: [], start: v, get v() { return at(tr, now); }, set v(x) { tr.start = x; } };
        trackers.push(tr); return tr;
      },
      animate(tr, to, d = 1, how = "inOut") { const t0 = group ? group.start : cursor; tr.segs.push({ t0, d, to, how }); if (group) group.longest = Math.max(group.longest, d); else cursor += d; stretch(t0 + d); },
      set(tr, to) { tr.segs.push({ t0: group ? group.start : cursor, d: 0, to, how: "linear" }); },
      /* words */
      title(text) { tl.titled = true; if (/\$/.test(String(text))) tl.usesTex = true; const key = `l${labelId++}`; return add({ draw(ctx, p) { say(key, "title", 0, 0, value(text), { alpha: ctx.globalAlpha * p }); } }, .6); },
      caption(text, o = {}) {
        tl.captioned = true; if (/\$/.test(String(text))) tl.usesTex = true;
        const key = `l${labelId++}`;
        const op = { caption: true, draw(ctx, p) { say(key, "caption", 0, 0, value(text), { alpha: ctx.globalAlpha * p }); } };
        for (const other of ops) if (other.caption && other.fadeAt == null) { other.fadeAt = group ? group.start : cursor; other.fadeD = .25; }
        return add(op, o.dur ?? .5);
      },
      text(pos, words, o = {}) { if (/\$/.test(String(words))) tl.usesTex = true; const key = `l${labelId++}`; return add({ draw(ctx, p, w, h) { const [x, y] = value(pos); say(key, "text", sx(x, w), sy(y, h), value(words), { alpha: ctx.globalAlpha * p, color: o.color ? colour(o.color) : undefined, size: o.size, align: o.align }); } }, o.dur ?? .4); },
      /* maths, typeset: tex([x, y], "\\int_a^b f(x)\\,dx") */
      tex(pos, latex, o = {}) { return api.text(pos, `$${value(latex)}$`, o); },

      /* parameters: a slider on Kimono's card. Its value is n.v; the script may animate it too. */
      slider(name, min = 0, max = 1, start = min, o = {}) {
        const label = o.label ?? name, step = o.step ?? ((max - min) / 100 >= 1 ? 1 : +((max - min) / 100).toPrecision(1));
        const param = { name, label, min, max, step, unit: o.unit, segs: [], start, get v() { const own = host.params[name]; return own != null ? own : at(param, now); } };
        tl.params = tl.params.filter((q) => q.name !== name).concat(param);
        return param;
      },
      /* a point the person can drag: p.x, p.y, p.v ([x, y]); { on: f } keeps it on y = f(x) */
      drag(start, o = {}) {
        const id = tl.drags.length;
        const pt = { id, start, o, get v() { const own = host.drags[id]; const [x, y] = own ?? value(start); return o.on ? [x, o.on(x)] : [x, y]; }, get x() { return this.v[0]; }, get y() { return this.v[1]; } };
        tl.drags.push(pt);
        add({ draw(ctx, p, w, h) {
          const [x, y] = pt.v, X = sx(x, w), Y = sy(y, h), r = 7 * ease.spring(p);
          ctx.fillStyle = col(o, 0); ctx.globalAlpha *= .22; ctx.beginPath(); ctx.arc(X, Y, r * 2.2, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha /= .22;
          ctx.fillStyle = css("--k-page"); ctx.beginPath(); ctx.arc(X, Y, r + 2.5, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = col(o, 0); ctx.beginPath(); ctx.arc(X, Y, r, 0, Math.PI * 2); ctx.fill();
          if (o.label) say(`d${id}`, "text", X + 12, Y - 14, value(o.label), { align: "left", alpha: ctx.globalAlpha });
        } }, o.dur ?? .4);
        return pt;
      },
      /* axes and plots */
      axes(o = {}) {
        view = { x: o.x ?? [-5, 5], y: o.y ?? [-5, 5], set: true };
        const xt = niceTicks(view.x[0], view.x[1], o.ticks ?? 8), yt = niceTicks(view.y[0], view.y[1], o.ticks ?? 6);
        return add({ draw(ctx, p, w, h) {
          ctx.lineWidth = 1;
          if (o.grid !== false) { ctx.strokeStyle = css("--k-line"); ctx.globalAlpha *= p; for (const t of xt) line(ctx, sx(t, w), sy(view.y[0], h), sx(t, w), sy(view.y[1], h)); for (const t of yt) line(ctx, sx(view.x[0], w), sy(t, h), sx(view.x[1], w), sy(t, h)); ctx.globalAlpha = 1; }
          ctx.strokeStyle = css("--k-soft"); ctx.lineWidth = 1.5;
          const y0 = Math.max(view.y[0], Math.min(view.y[1], 0)), x0 = Math.max(view.x[0], Math.min(view.x[1], 0));
          line(ctx, sx(view.x[0], w), sy(y0, h), sx(view.x[0] + (view.x[1] - view.x[0]) * p, w), sy(y0, h));
          line(ctx, sx(x0, w), sy(view.y[0], h), sx(x0, w), sy(view.y[0] + (view.y[1] - view.y[0]) * p, h));
          ctx.fillStyle = css("--k-soft"); ctx.font = font(11, 500); ctx.globalAlpha = p;
          ctx.textAlign = "center"; for (const t of xt) if (t !== x0) ctx.fillText(K.format(t, { short: false }), sx(t, w), sy(y0, h) + 15);
          ctx.textAlign = "right"; for (const t of yt) if (t !== y0) ctx.fillText(K.format(t, { short: false }), sx(x0, w) - 6, sy(t, h) + 4);
          if (o.labels) { ctx.font = font(13, 700); ctx.fillStyle = css("--k-ink"); ctx.textAlign = "right"; ctx.fillText(o.labels[0] ?? "", sx(view.x[1], w), sy(y0, h) - 8); ctx.textAlign = "left"; ctx.fillText(o.labels[1] ?? "", sx(x0, w) + 8, sy(view.y[1], h) + 12); }
        } }, o.dur ?? .8);
      },
      plot(f, o = {}) {
        const i = seriesIndex++;
        const from = o.from ?? view.x[0], to = o.to ?? view.x[1];
        return add({ draw(ctx, p, w, h) {
          ctx.strokeStyle = col(o, i); ctx.lineWidth = o.width ?? 3; ctx.lineJoin = ctx.lineCap = "round";
          ctx.beginPath(); let started = false; const n = 240, last = from + (value(to) - from) * p;
          for (let k = 0; k <= n; k++) { const x = from + (last - from) * k / n, y = f(x); if (!isFinite(y) || y < view.y[0] - 1e3 || y > view.y[1] + 1e3) { started = false; continue; } const X = sx(x, w), Y = sy(y, h); started ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); started = true; }
          ctx.stroke();
          if (o.label && p > .95) { const x = to - (to - from) * .04; ctx.fillStyle = col(o, i); ctx.font = font(13, 700); ctx.textAlign = "right"; ctx.fillText(o.label, sx(x, w), sy(f(x), h) - 10); }
        } }, o.dur ?? 1.2);
      },
      param(fn, o = {}) {
        const i = seriesIndex++, [a, b] = o.t ?? [0, 1];
        return add({ draw(ctx, p, w, h) { ctx.strokeStyle = col(o, i); ctx.lineWidth = o.width ?? 3; ctx.lineJoin = ctx.lineCap = "round"; ctx.beginPath(); const n = 300; for (let k = 0; k <= n; k++) { const [x, y] = fn(a + (b - a) * p * k / n); k ? ctx.lineTo(sx(x, w), sy(y, h)) : ctx.moveTo(sx(x, w), sy(y, h)); } ctx.stroke(); } }, o.dur ?? 1.5);
      },
      area(f, a, b, o = {}) {
        return add({ draw(ctx, p, w, h) { const B = a + (value(b) - a) * p; ctx.fillStyle = col(o, 0); ctx.globalAlpha *= o.opacity ?? .22; ctx.beginPath(); ctx.moveTo(sx(a, w), sy(0, h)); const n = 120; for (let k = 0; k <= n; k++) { const x = a + (B - a) * k / n; ctx.lineTo(sx(x, w), sy(f(x), h)); } ctx.lineTo(sx(B, w), sy(0, h)); ctx.closePath(); ctx.fill(); } }, o.dur ?? 1);
      },
      points(list, o = {}) {
        const i = seriesIndex++;
        return add({ draw(ctx, p, w, h) { const shown = value(list); const n = Math.ceil(shown.length * p); ctx.fillStyle = col(o, i); for (let k = 0; k < n; k++) { const [x, y] = shown[k]; ctx.beginPath(); ctx.arc(sx(x, w), sy(y, h), o.r ?? 4.5, 0, Math.PI * 2); ctx.fill(); } } }, o.dur ?? 1);
      },
      bars(list, o = {}) {
        const i = seriesIndex++;
        return add({ draw(ctx, p, w, h) {
          const rows = value(list).map((v, k) => Array.isArray(v) ? v : [k + 1, v]);
          const bw = Math.abs(sx(view.x[0] + (o.width ?? .7), w) - sx(view.x[0], w));
          rows.forEach(([x, y], k) => { const q = clamp(p * rows.length - k * .6); const top = sy(y * ease.out(q), h), base = sy(Math.max(view.y[0], 0), h); ctx.fillStyle = colour(Array.isArray(o.color) ? o.color[k] : o.color, Array.isArray(o.color) ? k : i); roundRect(ctx, sx(x, w) - bw / 2, Math.min(top, base), bw, Math.abs(base - top), 4); });
        } }, o.dur ?? 1.2);
      },
      dot(pos, o = {}) {
        return add({ draw(ctx, p, w, h) { const [x, y] = value(pos); const X = sx(x, w), Y = sy(y, h), r = (o.r ?? 6) * ease.spring(p); ctx.fillStyle = css("--k-page"); ctx.beginPath(); ctx.arc(X, Y, r + 2.5, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = o.color ? colour(o.color) : css("--k-ink"); ctx.beginPath(); ctx.arc(X, Y, r, 0, Math.PI * 2); ctx.fill(); if (o.label) { ctx.fillStyle = css("--k-ink"); ctx.font = font(13, 700); ctx.textAlign = "left"; ctx.fillText(value(o.label), X + 10, Y - 10); } } }, o.dur ?? .4);
      },
      line(a, b, o = {}) { return add({ draw(ctx, p, w, h) { const A = value(a), B = value(b); ctx.strokeStyle = colour(o.color ?? "soft"); ctx.lineWidth = o.width ?? 2; if (o.dashed) ctx.setLineDash([6, 5]); line(ctx, sx(A[0], w), sy(A[1], h), sx(A[0] + (B[0] - A[0]) * p, w), sy(A[1] + (B[1] - A[1]) * p, h)); ctx.setLineDash([]); } }, o.dur ?? .6); },
      arrow(a, b, o = {}) {
        return add({ draw(ctx, p, w, h) {
          const A = value(a), B = value(b), x1 = sx(A[0], w), y1 = sy(A[1], h), x2 = x1 + (sx(B[0], w) - x1) * p, y2 = y1 + (sy(B[1], h) - y1) * p;
          ctx.strokeStyle = ctx.fillStyle = col(o, 0); ctx.lineWidth = o.width ?? 2.5; line(ctx, x1, y1, x2, y2);
          const ang = Math.atan2(y2 - y1, x2 - x1), s = 10; ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - s * Math.cos(ang - .4), y2 - s * Math.sin(ang - .4)); ctx.lineTo(x2 - s * Math.cos(ang + .4), y2 - s * Math.sin(ang + .4)); ctx.closePath(); ctx.fill();
          if (o.label && p > .9) { ctx.font = font(13, 700); ctx.textAlign = "left"; ctx.fillText(value(o.label), x2 + 8, y2 - 8); }
        } }, o.dur ?? .6);
      },
      tangent(f, xAt, o = {}) {
        return add({ draw(ctx, p, w, h) { const x = value(xAt), e = 1e-4, m = (f(x + e) - f(x - e)) / (2 * e), len = (o.len ?? (view.x[1] - view.x[0]) / 4) * p; ctx.strokeStyle = col(o, 3); ctx.lineWidth = 2; line(ctx, sx(x - len, w), sy(f(x) - m * len, h), sx(x + len, w), sy(f(x) + m * len, h)); if (o.label !== false && p > .9) { ctx.fillStyle = col(o, 3); ctx.font = font(12, 700); ctx.textAlign = "left"; ctx.fillText(`slope ${m.toFixed(2)}`, sx(x + len, w) + 6, sy(f(x) + m * len, h)); } } }, o.dur ?? .6);
      },
      /* calculus */
      riemann(f, a, b, n = 8, o = {}) {
        const i = seriesIndex++;
        return add({ draw(ctx, p, w, h) {
          const N = Math.max(1, Math.round(value(n))), A = value(a), B = value(b), dx = (B - A) / N, how = o.method ?? "mid";
          const shown = Math.ceil(N * Math.min(1, p * 1.15));
          let sum = 0;
          for (let k = 0; k < N; k++) {
            const x0 = A + k * dx, x1 = x0 + dx;
            const y = how === "left" ? f(x0) : how === "right" ? f(x1) : how === "trap" ? (f(x0) + f(x1)) / 2 : f(x0 + dx / 2);
            sum += y * dx;
            if (k >= shown) continue;
            const Y0 = sy(0, h);
            ctx.fillStyle = col(o, i); ctx.globalAlpha = (o.opacity ?? .28);
            if (how === "trap") { ctx.beginPath(); ctx.moveTo(sx(x0, w), Y0); ctx.lineTo(sx(x0, w), sy(f(x0), h)); ctx.lineTo(sx(x1, w), sy(f(x1), h)); ctx.lineTo(sx(x1, w), Y0); ctx.closePath(); ctx.fill(); }
            else ctx.fillRect(sx(x0, w), Math.min(Y0, sy(y, h)), sx(x1, w) - sx(x0, w), Math.abs(sy(y, h) - Y0));
            ctx.globalAlpha = 1; ctx.strokeStyle = col(o, i); ctx.lineWidth = 1.2;
            if (how !== "trap") ctx.strokeRect(sx(x0, w), Math.min(Y0, sy(y, h)), sx(x1, w) - sx(x0, w), Math.abs(sy(y, h) - Y0));
          }
          if (o.sum !== false && p > .95) say(`r${i}`, "text", sx(B, w) - 4, sy(view.y[1], h) + 14, `${N} pieces ≈ ${K.format(sum, { short: false, digits: 3 })}`, { align: "right", color: col(o, i) });
        } }, o.dur ?? 1.4);
      },
      between(f, g, a, b, o = {}) {
        const i = seriesIndex++;
        return add({ draw(ctx, p, w, h) {
          const A = value(a), B = A + (value(b) - A) * p, n = 160;
          ctx.fillStyle = col(o, i); ctx.globalAlpha *= o.opacity ?? .25; ctx.beginPath();
          for (let k = 0; k <= n; k++) { const x = A + (B - A) * k / n; k ? ctx.lineTo(sx(x, w), sy(f(x), h)) : ctx.moveTo(sx(x, w), sy(f(x), h)); }
          for (let k = n; k >= 0; k--) { const x = A + (B - A) * k / n; ctx.lineTo(sx(x, w), sy(g(x), h)); }
          ctx.closePath(); ctx.fill();
        } }, o.dur ?? 1);
      },
      secant(f, a, b, o = {}) { return api.line(() => [value(a), f(value(a))], () => [value(b), f(value(b))], { color: o.color ?? "amber", ...o }); },
      vline(x, o = {}) { return api.line(() => [value(x), view.y[0]], () => [value(x), view.y[1]], { dashed: true, ...o }); },
      hline(y, o = {}) { return api.line(() => [view.x[0], value(y)], () => [view.x[1], value(y)], { dashed: true, ...o }); },
      polar(r, o = {}) { const [a, b] = o.t ?? [0, Math.PI * 2]; return api.param((t) => [r(t) * Math.cos(t), r(t) * Math.sin(t)], { ...o, t: [a, b] }); },
      implicit(F, o = {}) {
        const i = seriesIndex++, level = o.level ?? 0, res = Math.min(200, o.res ?? 110);
        return add({ draw(ctx, p, w, h) {
          const [x0, x1] = view.x, [y0, y1] = view.y, nx = res, ny = Math.round(res * (h / w)) || res;
          const gx = (k) => x0 + (x1 - x0) * k / nx, gy = (k) => y0 + (y1 - y0) * k / ny, upTo = Math.ceil(nx * p);
          ctx.strokeStyle = col(o, i); ctx.lineWidth = o.width ?? 2.5; ctx.beginPath();
          const v = (a, b) => F(a, b) - level;
          for (let a = 0; a < upTo; a++) for (let b = 0; b < ny; b++) {
            const xa = gx(a), xb = gx(a + 1), ya = gy(b), yb = gy(b + 1);
            const c = [v(xa, ya), v(xb, ya), v(xb, yb), v(xa, yb)], pts = [];
            const edge = (p0, p1, c0, c1) => { if ((c0 > 0) !== (c1 > 0)) { const t = c0 / (c0 - c1); pts.push([p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t]); } };
            edge([xa, ya], [xb, ya], c[0], c[1]); edge([xb, ya], [xb, yb], c[1], c[2]); edge([xb, yb], [xa, yb], c[2], c[3]); edge([xa, yb], [xa, ya], c[3], c[0]);
            for (let k = 0; k + 1 < pts.length; k += 2) { ctx.moveTo(sx(pts[k][0], w), sy(pts[k][1], h)); ctx.lineTo(sx(pts[k + 1][0], w), sy(pts[k + 1][1], h)); }
          }
          ctx.stroke();
        } }, o.dur ?? 1.4);
      },
      field(F, o = {}) {
        const i = seriesIndex++;
        return add({ draw(ctx, p, w, h) {
          const step = o.step ?? (view.x[1] - view.x[0]) / 18, slope = o.slope;
          ctx.strokeStyle = col(o, i); ctx.lineWidth = 1.6; ctx.globalAlpha *= p;
          for (let x = view.x[0] + step / 2; x < view.x[1]; x += step) for (let y = view.y[0] + step / 2; y < view.y[1]; y += step) {
            let [u, v] = slope ? [1, F(x, y)] : F(x, y);
            const len = Math.hypot(u, v) || 1, s = step * .38; u = u / len * s; v = v / len * s;
            const X0 = sx(x - u, w), Y0 = sy(y - v, h), X1 = sx(x + u, w), Y1 = sy(y + v, h);
            line(ctx, X0, Y0, X1, Y1);
            if (!slope) { const ang = Math.atan2(Y1 - Y0, X1 - X0); ctx.beginPath(); ctx.moveTo(X1, Y1); ctx.lineTo(X1 - 5 * Math.cos(ang - .5), Y1 - 5 * Math.sin(ang - .5)); ctx.moveTo(X1, Y1); ctx.lineTo(X1 - 5 * Math.cos(ang + .5), Y1 - 5 * Math.sin(ang + .5)); ctx.stroke(); }
          }
        } }, o.dur ?? 1);
      },
      vectorField(F, o = {}) { return api.field(F, o); },
      slopeField(F, o = {}) { return api.field(F, { ...o, slope: true }); },
      /* numbers people's code can use */
      integrate(f, a, b, n = 400) { const dx = (b - a) / n; let s = f(a) + f(b); for (let k = 1; k < n; k++) s += f(a + k * dx) * (k % 2 ? 4 : 2); return s * dx / 3; },
      derivative(f, e = 1e-4) { return (x) => (f(x + e) - f(x - e)) / (2 * e); },
      random: () => Math.random(),

      /* 3D */
      axes3d(o = {}) { tl.uses3d = true; tl.view3d = { x: o.x ?? [-3, 3], y: o.y ?? [-3, 3], z: o.z ?? [-3, 3] }; return add3d((T, g) => axes3dObject(T, tl.view3d, o), (obj, p) => { obj.scale.setScalar(Math.max(.001, ease.out(p))); }, o.dur ?? .8); },
      surface(f, o = {}) {
        tl.uses3d = true; const i = seriesIndex++;
        return add3d((T) => surfaceObject(T, f, o, colour(o.color, i), tl.view3d), (obj, p) => { obj.scale.set(1, 1, Math.max(.001, ease.inOut(p))); obj.material.opacity = (o.opacity ?? .85) * Math.min(1, p * 1.5); }, o.dur ?? 1.6);
      },
      curve3d(fn, o = {}) {
        tl.uses3d = true; const i = seriesIndex++;
        return add3d((T) => curveObject(T, fn, o, colour(o.color, i)), (obj, p) => { obj.geometry.setDrawRange(0, Math.floor(obj.userData.n * p) + 1); }, o.dur ?? 1.6);
      },
      point3d(pos, o = {}) {
        tl.uses3d = true;
        return add3d((T) => new T.Mesh(new T.SphereGeometry(o.r ?? .09, 20, 14), new T.MeshStandardMaterial({ color: colour(o.color, 0), roughness: .5 })), (obj, p) => { const [x, y, z] = value(pos); obj.position.set(x, z, -y); obj.scale.setScalar(Math.max(.001, ease.spring(p))); }, o.dur ?? .4);
      },
      vector3d(to, o = {}) {
        tl.uses3d = true;
        return add3d((T) => { const g = new T.ArrowHelper(new T.Vector3(1, 0, 0), new T.Vector3(), 1, colour(o.color, 0), .22, .12); return g; }, (obj, p) => { const [x, y, z] = value(to), [a, b, c] = value(o.from ?? [0, 0, 0]); const v = new obj.position.constructor(x - a, z - c, -(y - b)); const len = v.length() * Math.max(.001, ease.out(p)); obj.position.set(a, c, -b); if (len > 1e-6) { obj.setDirection(v.normalize()); obj.setLength(len, Math.min(.22, len * .3), Math.min(.12, len * .2)); } }, o.dur ?? .6);
      },
      /* the flat region between f and g (z = g(x) to f(x)), standing in the plane it will turn in */
      region3d(f, g, a, b, o = {}) {
        tl.uses3d = true; const i = seriesIndex++;
        return add3d((T) => { const n = 120, pos = [], idx = []; for (let k = 0; k <= n; k++) { const x = a + (b - a) * k / n; pos.push(x, f(x), 0, x, g ? g(x) : 0, 0); if (k) idx.push(2 * k - 2, 2 * k - 1, 2 * k, 2 * k - 1, 2 * k + 1, 2 * k); } const geo = new T.BufferGeometry(); geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); return new T.Mesh(geo, new T.MeshBasicMaterial({ color: colour(o.color, i), side: T.DoubleSide, transparent: true, opacity: o.opacity ?? .55 })); },
          (obj, p) => { obj.material.opacity = (o.opacity ?? .55) * Math.min(1, p * 1.5); }, o.dur ?? .8);
      },
      /* the solid made by turning the region between f (outside) and g (inside) round the x axis; it sweeps round as it appears */
      revolve(f, g, a, b, o = {}) {
        tl.uses3d = true; const i = seriesIndex++;
        return add3d((T) => solidObject(T, f, g, a, b, o, colour(o.color, i)), (obj, p) => { obj.geometry.setDrawRange(0, Math.ceil(obj.userData.perStep * obj.userData.steps * p)); }, o.dur ?? 2);
      },
      /* one slice of it at x: a washer (or a disc when g is left out), dx thick */
      washer(xAt, f, g, o = {}) {
        tl.uses3d = true;
        return add3d((T) => { const m = new T.Mesh(new T.BufferGeometry(), new T.MeshStandardMaterial({ color: colour(o.color ?? "amber"), roughness: .45, emissive: colour(o.color ?? "amber"), emissiveIntensity: .25 })); m.userData.key = ""; return m; },
          (obj, p, t, T) => { const x = value(xAt), R = Math.abs(f(x)), r = g ? Math.abs(g(x)) : 0, dx = value(o.dx ?? .12); const key = `${x.toFixed(3)}|${R.toFixed(3)}|${r.toFixed(3)}|${dx}`; if (key !== obj.userData.key) { obj.userData.key = key; obj.geometry.dispose(); obj.geometry = washerGeometry(T, R, r, dx); obj.position.set(x - dx / 2, 0, 0); } obj.scale.setScalar(Math.max(.001, ease.spring(p))); }, o.dur ?? .5);
      },
      disc(xAt, f, o = {}) { return api.washer(xAt, f, null, o); },
      /* n slices side by side: the volume, added up */
      washers(f, g, a, b, n = 8, o = {}) {
        tl.uses3d = true; const i = seriesIndex++;
        return add3d((T) => { const group = new T.Group(); group.userData.key = ""; return group; },
          (group, p, t, T) => {
            const N = Math.max(1, Math.round(value(n))), A = value(a), B = value(b), dx = (B - A) / N;
            if (group.userData.key !== `${N}|${A}|${B}`) {
              group.userData.key = `${N}|${A}|${B}`;
              group.children.forEach((c) => c.geometry.dispose()); group.clear();
              for (let k = 0; k < N; k++) { const x = A + (k + .5) * dx; const m = new T.Mesh(washerGeometry(T, Math.abs(f(x)), g ? Math.abs(g(x)) : 0, dx * .92), new T.MeshStandardMaterial({ color: colour(o.color, i), roughness: .5 })); m.position.set(A + k * dx + dx * .04, 0, 0); group.add(m); }
            }
            const shown = Math.ceil(group.children.length * p);
            group.children.forEach((c, k) => { c.visible = k < shown; });
          }, o.dur ?? 1.6);
      },
      discs(f, a, b, n = 8, o = {}) { return api.washers(f, null, a, b, n, o); },
      /* a surface given as (u, v) → [x, y, z] */
      surfaceParam(fn, o = {}) {
        tl.uses3d = true; const i = seriesIndex++;
        return add3d((T) => paramSurfaceObject(T, fn, o, colour(o.color, i)), (obj, p) => { obj.material.opacity = (o.opacity ?? .85) * Math.min(1, p * 1.4); obj.scale.setScalar(Math.max(.001, .6 + .4 * ease.out(p))); }, o.dur ?? 1.4);
      },
      /* a label in 3D, following the camera */
      label3d(pos, text, o = {}) {
        tl.uses3d = true; if (/\$/.test(String(text))) tl.usesTex = true;
        const key = `l${labelId++}`;
        return add3d((T) => { const g = new T.Object3D(); g.userData.label = true; return g; }, (obj, p) => { const [x, y, z] = value(pos); obj.position.set(x, z, -y); obj.userData.say = { key, text: value(text), alpha: p, color: o.color ? colour(o.color) : undefined }; }, o.dur ?? .4);
      },
      camera(o = {}, d = 1.5) { tl.uses3d = true; tl.cams ??= []; tl.cams.push({ t0: group ? group.start : cursor, d, to: o }); if (group) group.longest = Math.max(group.longest, d); else cursor += d; stretch((group ? group.start : cursor) + (group ? d : 0)); },
      orbit(deg = 360, d = 6) { tl.uses3d = true; tl.cams ??= []; const t0 = group ? group.start : cursor; tl.cams.push({ t0, d, spin: deg }); if (group) group.longest = Math.max(group.longest, d); else cursor += d; stretch(t0 + d); },
      /* helpers people's code can use */
      PI: Math.PI, sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, log: Math.log, sqrt: Math.sqrt, abs: Math.abs, pow: Math.pow, floor: Math.floor, round: Math.round, min: Math.min, max: Math.max,
      range(a, b, step = 1) { const out = []; for (let v = a; step > 0 ? v <= b + 1e-9 : v >= b - 1e-9; v += step) out.push(+v.toFixed(10)); return out; },
      color: (name) => colour(name),
    };
    api.label = api.text;

    function add3d(make, update, d) {
      const op = { three: { make, update } };
      return add(op, d);
    }
    function at(tr, t) {
      let v = tr.start;
      for (const s of tr.segs) { if (t < s.t0) break; const from = v; const p = s.d ? clamp((t - s.t0) / s.d) : 1; v = from + (s.to - from) * (ease[s.how] ?? ease.inOut)(p); }
      return v;
    }

    tl.api = api;
    tl.dragAt = (X, Y, w, h) => { for (let k = tl.drags.length - 1; k >= 0; k--) { const [x, y] = tl.drags[k].v; if (Math.hypot(sx(x, w) - X, sy(y, h) - Y) < 16) return k; } return null; };
    tl.dragTo = (id, X, Y, w, h) => {
      const pt = tl.drags[id]; if (!pt) return;
      let x = Math.max(view.x[0], Math.min(view.x[1], ux(X, w))), y = Math.max(view.y[0], Math.min(view.y[1], uy(Y, h)));
      if (pt.o.x) x = Math.max(pt.o.x[0], Math.min(pt.o.x[1], x));
      host.drags[id] = [x, y];
    };
    tl.paint = (ctx, t, w, h) => {
      now = t;
      tl.labels = [];
      for (const op of ops) {
        if (!op.draw || t < op.t0) continue;
        const p = op.d ? clamp((t - op.t0) / op.d) : 1;
        let alpha = 1;
        if (op.fadeAt != null && t >= op.fadeAt) alpha = 1 - clamp((t - op.fadeAt) / (op.fadeD || .001));
        if (alpha <= 0) continue;
        ctx.save(); ctx.globalAlpha = alpha;
        try { op.draw(ctx, ease.inOut(p), w, h); } catch { /* a step that can't draw yet */ }
        ctx.restore();
      }
    };
    tl.mount3d = () => {
      const gl = host.gl; if (!gl || !THREE) return;
      const T = THREE;
      tl.dispose?.();
      const root = new T.Group();
      gl.scene.add(root);
      gl.scene.add(tl.light ??= new T.HemisphereLight(0xffffff, 0x886666, 2.2));
      const sun = new T.DirectionalLight(0xffffff, 1.4); sun.position.set(3, 6, 4); root.add(sun);
      for (const op of ops) if (op.three) { try { op.three.obj = op.three.make(T); op.three.obj.visible = false; root.add(op.three.obj); } catch (e) { console.error(e); } }
      tl.three = root;
      tl.dispose = () => { gl.scene.remove(root); root.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); tl.three = null; };
    };
    tl.paint3d = (gl, t) => {
      if (!tl.three) tl.mount3d();
      if (!tl.three) return;
      now = t;
      for (const op of ops) {
        const obj = op.three?.obj; if (!obj) continue;
        obj.visible = t >= op.t0 && !(op.fadeAt != null && t >= op.fadeAt + (op.fadeD || 0));
        if (!obj.visible) continue;
        try { op.three.update(obj, op.d ? clamp((t - op.t0) / op.d) : 1, t, THREE); } catch { /* not yet */ }
      }
      /* the camera: a slow turn, then wherever camera() and orbit() take it */
      /* framed on what's drawn: the middle of axes3d's box, far enough to see all of it */
      const v3 = tl.view3d ?? { x: [-3, 3], y: [-3, 3], z: [-3, 3] };
      const cx = (v3.x[0] + v3.x[1]) / 2, cy = (v3.y[0] + v3.y[1]) / 2, cz = (v3.z[0] + v3.z[1]) / 2;
      const span = Math.max(v3.x[1] - v3.x[0], v3.y[1] - v3.y[0], v3.z[1] - v3.z[0]);
      let az = 35, el = 24, dist = span * 2.3;
      for (const c of tl.cams ?? []) {
        if (t < c.t0) break;
        const p = ease.inOut(c.d ? clamp((t - c.t0) / c.d) : 1);
        if (c.spin != null) az += c.spin * p;
        else { az += ((c.to.az ?? az) - az) * p; el += ((c.to.el ?? el) - el) * p; dist += ((c.to.dist ?? dist) - dist) * p; }
      }
      az += host.turn.az; el = Math.max(-85, Math.min(85, el + host.turn.el));
      const a = az * Math.PI / 180, e = el * Math.PI / 180;
      gl.camera.position.set(cx + dist * Math.cos(e) * Math.sin(a), cz + dist * Math.sin(e), -cy + dist * Math.cos(e) * Math.cos(a));
      gl.camera.lookAt(cx, cz, -cy);
      gl.camera.updateMatrixWorld();
      gl.renderer.render(gl.scene, gl.camera);
      /* labels in 3D: where they land on the screen */
      for (const op of ops) {
        const obj = op.three?.obj; const said = obj?.userData?.say;
        if (!said || !obj.visible) continue;
        const v = obj.getWorldPosition(new THREE.Vector3()).project(gl.camera);
        if (v.z > 1) continue;
        tl.labels.push({ key: said.key, kind: "text", x: (v.x + 1) / 2 * host.w, y: (1 - v.y) / 2 * host.h, text: said.text, alpha: said.alpha, color: said.color });
      }
    };
    return tl;
  }

  /* 3D objects (three.js, x right, z up in the scene's words; y up in three's) */
  function axes3dObject(T, v, o) {
    const g = new T.Group(), soft = new T.Color(css("--k-soft"));
    const mat = new T.LineBasicMaterial({ color: soft, transparent: true, opacity: .8 });
    const seg = (a, b) => g.add(new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(...a), new T.Vector3(...b)]), mat));
    seg([v.x[0], 0, 0], [v.x[1], 0, 0]); seg([0, v.z[0], 0], [0, v.z[1], 0]); seg([0, 0, -v.y[0]], [0, 0, -v.y[1]]);
    if (o.grid !== false) {
      const grid = new T.GridHelper(Math.max(v.x[1] - v.x[0], v.y[1] - v.y[0]), 12, new T.Color(css("--k-line")), new T.Color(css("--k-line")));
      grid.material.transparent = true; grid.material.opacity = .7; g.add(grid);
    }
    const label = (text, pos) => { const s = textSprite(T, text); s.position.set(...pos); g.add(s); };
    label(o.labels?.[0] ?? "x", [v.x[1] + .3, 0, 0]); label(o.labels?.[1] ?? "y", [0, 0, -v.y[1] - .3]); label(o.labels?.[2] ?? "z", [0, v.z[1] + .3, 0]);
    return g;
  }
  function surfaceObject(T, f, o, color, v) {
    const xr = o.x ?? v?.x ?? [-3, 3], yr = o.y ?? v?.y ?? [-3, 3], n = Math.min(80, o.res ?? 48);
    const geo = new T.PlaneGeometry(xr[1] - xr[0], yr[1] - yr[0], n, n);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i) + (xr[0] + xr[1]) / 2, y = pos.getY(i) + (yr[0] + yr[1]) / 2; pos.setXYZ(i, x, y, f(x, y)); }
    geo.computeVertexNormals();
    const mesh = new T.Mesh(geo, new T.MeshStandardMaterial({ color, side: T.DoubleSide, roughness: .55, metalness: .05, transparent: true, opacity: o.opacity ?? .85, wireframe: !!o.wire }));
    mesh.rotation.x = -Math.PI / 2;
    const holder = new T.Group(); holder.add(mesh);
    holder.material = mesh.material;
    /* scale z (three's y after the turn) to grow it out of the floor */
    holder.scale.set = function (x, y, z) { mesh.scale.set(1, 1, z); return holder.scale; };
    return holder;
  }
  function curveObject(T, fn, o, color) {
    const [a, b] = o.t ?? [0, 1], n = 400, pts = [];
    for (let k = 0; k <= n; k++) { const [x, y, z] = fn(a + (b - a) * k / n); pts.push(new T.Vector3(x, z, -y)); }
    const line = new T.Line(new T.BufferGeometry().setFromPoints(pts), new T.LineBasicMaterial({ color, linewidth: 2 }));
    line.userData.n = n;
    return line;
  }
  function textSprite(T, text) {
    const c = document.createElement("canvas"), x = c.getContext("2d"); c.width = 128; c.height = 64;
    x.font = `700 40px ${css("--k-sans")}`; x.fillStyle = css("--k-ink"); x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(text, 64, 32);
    const s = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c), transparent: true })); s.scale.set(.6, .3, 1); return s;
  }

  /* the solid of revolution: built in slices of angle, so drawing more of it sweeps it round */
  function solidObject(T, f, g, a, b, o, color) {
    const steps = o.segments ?? 72, nx = o.res ?? 64, sweep = o.angle ?? Math.PI * 2, pos = [];
    const P = (x, rad, th) => [x, rad * Math.cos(th), rad * Math.sin(th)];
    const quad = (p0, p1, p2, p3) => pos.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
    let perStep = 0;
    for (let j = 0; j < steps; j++) {
      const t0 = sweep * j / steps, t1 = sweep * (j + 1) / steps, before = pos.length;
      for (let k = 0; k < nx; k++) {
        const x0 = a + (b - a) * k / nx, x1 = a + (b - a) * (k + 1) / nx;
        quad(P(x0, Math.abs(f(x0)), t0), P(x1, Math.abs(f(x1)), t0), P(x1, Math.abs(f(x1)), t1), P(x0, Math.abs(f(x0)), t1));
        if (g) quad(P(x0, Math.abs(g(x0)), t1), P(x1, Math.abs(g(x1)), t1), P(x1, Math.abs(g(x1)), t0), P(x0, Math.abs(g(x0)), t0));
      }
      for (const x of [a, b]) { const R = Math.abs(f(x)), r = g ? Math.abs(g(x)) : 0; quad(P(x, r, t0), P(x, R, t0), P(x, R, t1), P(x, r, t1)); }
      perStep = (pos.length - before) / 3;
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const mesh = new T.Mesh(geo, new T.MeshStandardMaterial({ color, side: T.DoubleSide, roughness: .5, transparent: true, opacity: o.opacity ?? .45, depthWrite: false }));
    mesh.userData.perStep = perStep; mesh.userData.steps = steps;
    return mesh;
  }
  /* a washer: the ring between r and R, dx thick, lying across the x axis */
  function washerGeometry(T, R, r, dx) {
    const shape = new T.Shape(); shape.absarc(0, 0, Math.max(R, 1e-3), 0, Math.PI * 2, false);
    if (r > 1e-3) { const hole = new T.Path(); hole.absarc(0, 0, Math.min(r, R * .999), 0, Math.PI * 2, true); shape.holes.push(hole); }
    const geo = new T.ExtrudeGeometry(shape, { depth: Math.max(dx, 1e-3), bevelEnabled: false, curveSegments: 56 });
    geo.rotateY(Math.PI / 2);
    return geo;
  }
  function paramSurfaceObject(T, fn, o, color) {
    const [u0, u1] = o.u ?? [0, 1], [v0, v1] = o.v ?? [0, 1], n = Math.min(90, o.res ?? 48), pos = [], idx = [];
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) { const [x, y, z] = fn(u0 + (u1 - u0) * i / n, v0 + (v1 - v0) * j / n); pos.push(x, z, -y); }
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const a = i * (n + 1) + j, b = a + n + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const geo = new T.BufferGeometry(); geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    return new T.Mesh(geo, new T.MeshStandardMaterial({ color, side: T.DoubleSide, roughness: .55, transparent: true, opacity: o.opacity ?? .85, wireframe: !!o.wire }));
  }
  /* repeatable randomness (mulberry32) */
  function seeded(seed) { let a = seed >>> 0; return () => { a += 0x6d2b79f5; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  /* words with $…$ maths in them: KaTeX once it has loaded, the raw text until then */
  function setRich(node, text) {
    const parts = String(text).split(/(\$[^$]+\$)/g);
    node.replaceChildren(...parts.filter(Boolean).map((part) => {
      if (/^\$[^$]+\$$/.test(part) && window.katex) { const span = document.createElement("span"); span.innerHTML = window.katex.renderToString(part.slice(1, -1), { throwOnError: false }); return span; }
      return document.createTextNode(part.replace(/^\$|\$$/g, ""));
    }));
  }
  let katexLoading = null;
  function loadKatex() {
    if (window.katex || katexLoading) return katexLoading;
    katexLoading = new Promise((done) => {
      const link = document.createElement("link"); link.rel = "stylesheet"; link.href = `${KIT_BASE}katex/katex.min.css`; document.head.append(link);
      const script = document.createElement("script"); script.src = `${KIT_BASE}katex/katex.min.js`; script.onload = done; script.onerror = done; document.head.append(script);
    });
    return katexLoading;
  }
  K.loadKatex = loadKatex;

  function line(ctx, x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  function roundRect(ctx, x, y, w, h, r) { if (h < .5) return; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, Math.min(r, h / 2)) : ctx.rect(x, y, w, h); ctx.fill(); }
  function wrap(ctx, text, x, y, max, lh) {
    const words = String(text).split(/\s+/), rows = []; let row = "";
    for (const w of words) { const next = row ? `${row} ${w}` : w; if (ctx.measureText(next).width > max && row) { rows.push(row); row = w; } else row = next; }
    rows.push(row);
    rows.forEach((r, i) => ctx.fillText(r, x, y - (rows.length - 1 - i) * lh));
  }

  const define = (name, cls) => { if (!customElements.get(name)) customElements.define(name, cls); };
  define("k-chart", Chart); define("k-stat", Stat); define("k-grid", Grid); define("k-card", Card); define("k-table", Table);
  define("k-tabs", Tabs); define("k-tab", class extends HTMLElement {}); define("k-row", class extends HTMLElement {});
  define("k-slider", Slider); define("k-progress", Progress); define("k-callout", Callout); define("k-scene", Scene);
  K.loadThree = loadThree; K.base = KIT_BASE;
})();
