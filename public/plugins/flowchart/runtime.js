// Semantic professional-diagram sources rendered inside the existing widget iframe.
  const DIAGRAM_RUNTIME = (() => {
    const VERSION = "penecho-diagram-source-v1";
    const FORMATS = Object.freeze([
      { id:"mermaid", label:"Mermaid", aliases:["mermaid"] },
      { id:"dot", label:"Graphviz DOT", aliases:["dot", "graphviz", "graphviz-dot", "graphviz dot"] },
      { id:"bpmn-xml", label:"BPMN XML", aliases:["bpmn", "bpmn-xml", "bpmn2", "bpmn-2.0-xml"] },
      { id:"vega-lite", label:"Vega-Lite JSON", aliases:["vega-lite", "vegalite", "vega-lite-json"] },
      { id:"geojson", label:"GeoJSON", aliases:["geojson", "geo-json"] },
      { id:"smiles", label:"SMILES", aliases:["smiles"] },
      { id:"cytoscape-json", label:"Cytoscape JSON", aliases:["cytoscape", "cytoscape-json", "cytoscape-elements-json"] },
    ]);
    const aliases = new Map();
    for (const format of FORMATS)
      for (const alias of format.aliases) aliases.set(alias, format.id);

    function normalizeFormat(value) {
      return aliases.get(String(value || "").trim().toLowerCase()) || "";
    }
    function formatRecord(value) {
      const id = normalizeFormat(value);
      return FORMATS.find((format) => format.id === id) || null;
    }
    function copyLabel(value) {
      return `Copy ${formatRecord(value)?.label || String(value || "source").trim()}`;
    }
    function scriptValue(value) {
      return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    }
    function utf8Base64(value) {
      const bytes = new TextEncoder().encode(value);
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 8192)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      return btoa(binary);
    }
    function escapeHtml(value) {
      return String(value || "").replace(/[&<>"']/g, (character) => ({
        "&":"&amp;",
        "<":"&lt;",
        ">":"&gt;",
        '"':"&quot;",
        "'":"&#39;",
      })[character]);
    }
    function frameRuntime(config) {
      const stage = document.querySelector("#diagram-stage"),
        status = document.querySelector("#diagram-status"),
        root = document.querySelector(".pd-root"),
        source = new TextDecoder().decode(Uint8Array.from(atob(config.sourceBase64), (character) => character.charCodeAt(0))),
        format = config.sourceFormat;
      let resizeRender = null,
        timedOut = false;
      const notify = () => {
        try { parent.postMessage({ type:"penecho-widget-updated" }, "*"); } catch {}
      };
      const showStatus = (message, error = false) => {
        if (!status.isConnected) stage.append(status);
        status.textContent = message;
        status.hidden = false;
        status.classList.toggle("is-error", error);
        root.classList.toggle("is-error", error);
        notify();
      };
      const finish = () => {
        status.hidden = true;
        root.classList.remove("is-error");
        notify();
      };
      const loadScript = (url) => new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = url;
        script.crossOrigin = "anonymous";
        script.referrerPolicy = "no-referrer";
        script.onload = resolve;
        script.onerror = () => reject(Error(`Could not load ${url}`));
        document.head.append(script);
      });
      const loadStyle = (url) => new Promise((resolve, reject) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = url;
        link.crossOrigin = "anonymous";
        link.referrerPolicy = "no-referrer";
        link.onload = resolve;
        link.onerror = () => reject(Error(`Could not load ${url}`));
        document.head.append(link);
      });
      const parseJson = () => {
        try { return JSON.parse(source); }
        catch { throw Error(`${format} source is not valid JSON`); }
      };
      async function renderMermaid() {
        const { default:mermaid } = await import("https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.esm.min.mjs");
        mermaid.initialize({ startOnLoad:false, securityLevel:"strict", theme:"base" });
        const rendered = await mermaid.render(`penecho-${Math.random().toString(36).slice(2)}`, source);
        stage.innerHTML = rendered.svg;
        rendered.bindFunctions?.(stage);
        const svg = stage.querySelector("svg");
        if (svg) {
          svg.removeAttribute("height");
          svg.style.width = "100%";
          svg.style.height = "100%";
          svg.style.maxWidth = "100%";
        }
      }
      async function renderDot() {
        const { instance } = await import("https://cdn.jsdelivr.net/npm/@viz-js/viz@3.9.0/lib/viz-standalone.mjs"),
          viz = await instance(),
          svg = viz.renderSVGElement(source);
        svg.removeAttribute("width");
        svg.removeAttribute("height");
        svg.style.width = "100%";
        svg.style.height = "100%";
        stage.replaceChildren(svg);
      }
      async function renderBpmn() {
        await Promise.all([
          loadStyle("https://cdn.jsdelivr.net/npm/bpmn-js@17.11.1/dist/assets/diagram-js.css"),
          loadStyle("https://cdn.jsdelivr.net/npm/bpmn-js@17.11.1/dist/assets/bpmn-font/css/bpmn.css"),
          loadScript("https://cdn.jsdelivr.net/npm/bpmn-js@17.11.1/dist/bpmn-viewer.development.js"),
        ]);
        if (typeof globalThis.BpmnJS !== "function") throw Error("BPMN renderer did not initialize");
        const viewer = new globalThis.BpmnJS({ container:stage });
        await viewer.importXML(source);
        const fit = () => {
          try { viewer.get("canvas").zoom("fit-viewport"); } catch {}
        };
        fit();
        resizeRender = fit;
      }
      async function renderVegaLite() {
        await loadScript("https://cdn.jsdelivr.net/npm/vega@5.30.0/build/vega.min.js");
        await loadScript("https://cdn.jsdelivr.net/npm/vega-lite@5.20.1/build/vega-lite.min.js");
        await loadScript("https://cdn.jsdelivr.net/npm/vega-embed@6.26.0/build/vega-embed.min.js");
        if (typeof globalThis.vegaEmbed !== "function") throw Error("Vega-Lite renderer did not initialize");
        const result = await globalThis.vegaEmbed(stage, parseJson(), { actions:false, renderer:"svg" });
        resizeRender = () => result.view?.resize?.().runAsync?.().then(notify).catch(() => {});
      }
      async function renderGeoJson() {
        await Promise.all([
          loadStyle("https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css"),
          loadScript("https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"),
        ]);
        if (!globalThis.L?.map) throw Error("GeoJSON renderer did not initialize");
        const map = globalThis.L.map(stage, { attributionControl:false, zoomControl:true, preferCanvas:true }),
          layer = globalThis.L.geoJSON(parseJson(), {
            style:{ color:"#2563eb", weight:3, opacity:.9, fillColor:"#93c5fd", fillOpacity:.22 },
            pointToLayer:(_feature, latlng) => globalThis.L.circleMarker(latlng, {
              radius:7, color:"#1d4ed8", weight:2, fillColor:"#60a5fa", fillOpacity:.85,
            }),
          }).addTo(map),
          bounds = layer.getBounds();
        if (bounds.isValid()) map.fitBounds(bounds, { padding:[24, 24] });
        else map.setView([0, 0], 2);
        resizeRender = () => {
          map.invalidateSize(false);
          if (bounds.isValid()) map.fitBounds(bounds, { padding:[24, 24], animate:false });
        };
      }
      async function renderSmiles() {
        await loadScript("https://cdn.jsdelivr.net/npm/smiles-drawer@2.1.7/dist/smiles-drawer.min.js");
        if (!globalThis.SmilesDrawer?.parse) throw Error("SMILES renderer did not initialize");
        const tree = await new Promise((resolve, reject) => globalThis.SmilesDrawer.parse(source, resolve, reject)),
          canvas = document.createElement("canvas");
        stage.replaceChildren(canvas);
        const draw = () => {
          const width = Math.max(320, stage.clientWidth),
            height = Math.max(220, stage.clientHeight),
            ratio = Math.min(2, globalThis.devicePixelRatio || 1);
          canvas.width = Math.round(width * ratio);
          canvas.height = Math.round(height * ratio);
          canvas.style.width = `${width}px`;
          canvas.style.height = `${height}px`;
          new globalThis.SmilesDrawer.Drawer({ width:canvas.width, height:canvas.height, bondThickness:2 * ratio, padding:30 * ratio }).draw(tree, canvas, "light", false);
        };
        draw();
        resizeRender = draw;
      }
      async function renderCytoscape() {
        await loadScript("https://cdn.jsdelivr.net/npm/cytoscape@3.30.4/dist/cytoscape.min.js");
        if (typeof globalThis.cytoscape !== "function") throw Error("Cytoscape renderer did not initialize");
        const parsed = parseJson(),
          cy = globalThis.cytoscape({
            container:stage,
            elements:Array.isArray(parsed) ? parsed : parsed.elements,
            layout:{ name:"cose", animate:false, fit:true, padding:36 },
            style:[
              { selector:"node", style:{ "background-color":"#ffffff", "border-color":"#64748b", "border-width":2, label:"data(label)", color:"#172033", "font-size":16, "text-wrap":"wrap", "text-max-width":150, width:72, height:44 } },
              { selector:"edge", style:{ width:2, "line-color":"#64748b", "target-arrow-color":"#64748b", "target-arrow-shape":"triangle", "curve-style":"bezier", label:"data(label)", "font-size":13, "text-background-color":"#ffffff", "text-background-opacity":.85, "text-background-padding":3 } },
            ],
          });
        resizeRender = () => { cy.resize(); cy.fit(undefined, 36); };
      }
      async function render() {
        if (format === "mermaid") await renderMermaid();
        else if (format === "dot") await renderDot();
        else if (format === "bpmn-xml") await renderBpmn();
        else if (format === "vega-lite") await renderVegaLite();
        else if (format === "geojson") await renderGeoJson();
        else if (format === "smiles") await renderSmiles();
        else if (format === "cytoscape-json") await renderCytoscape();
        else throw Error(`Unsupported local renderer: ${format}`);
      }
      const timer = setTimeout(() => {
        timedOut = true;
        showStatus(`${config.label} rendering timed out. The source remains available from Copy.`, true);
      }, 9000);
      render().then(() => {
        clearTimeout(timer);
        finish();
      }).catch((error) => {
        clearTimeout(timer);
        showStatus(`${config.label} could not be rendered. ${String(error?.message || error).slice(0, 220)}`, true);
      });
      if (typeof ResizeObserver === "function") {
        let resizeTimer = 0;
        new ResizeObserver(() => {
          clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => {
            if (!timedOut) resizeRender?.();
            notify();
          }, 80);
        }).observe(stage);
      }
    }
    function documentFor({ sourceFormat, source, title }) {
      const format = formatRecord(sourceFormat);
      if (!format || typeof source !== "string" || !source.trim() || new TextEncoder().encode(source).length > 20000) return "";
      const config = {
        sourceFormat:format.id,
        label:format.label,
        sourceBase64:utf8Base64(source),
      };
      return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title || format.label)}</title>
  <style>
    html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}
    body{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172033}
    .pd-root{box-sizing:border-box;display:grid;grid-template-rows:auto minmax(0,1fr);gap:12px;width:100%;height:100%;padding:18px;background:transparent}
    .pd-title{margin:0;font-size:clamp(20px,3.2cqw,38px);line-height:1.15;font-weight:700;color:var(--pd-text,#172033)}
    .pd-stage{position:relative;min-width:0;min-height:0;width:100%;height:100%;overflow:hidden}
    .pd-stage>svg,.pd-stage>.vega-embed,.pd-stage>.vega-embed>div{display:block;width:100%;height:100%;max-width:100%;max-height:100%}
    .pd-stage canvas{display:block;max-width:100%;max-height:100%}
    .pd-status{position:absolute;inset:0;display:grid;place-items:center;padding:24px;text-align:center;font-size:clamp(15px,2.1cqw,24px);line-height:1.4;color:var(--pd-muted,#5f6b7a);background:rgba(255,255,255,.94)}
    .pd-status.is-error{color:var(--pd-danger,#b42318)}
    @container (max-width:560px){.pd-root{padding:12px;gap:8px}}
  </style>
</head>
<body>
  <main class="pd-root" data-pd-palette="standard" data-pd-density="comfortable">
    <h1 class="pd-title">${escapeHtml(title || format.label)}</h1>
    <section id="diagram-stage" class="pd-stage" aria-label="${escapeHtml(format.label)} diagram">
      <p id="diagram-status" class="pd-status">Rendering ${escapeHtml(format.label)}...</p>
    </section>
  </main>
  <script type="module">(${frameRuntime.toString()})(${scriptValue(config)});</script>
</body>
</html>`;
    }
    return Object.freeze({
      VERSION,
      FORMATS,
      normalizeFormat,
      supports:(value) => Boolean(normalizeFormat(value)),
      formatRecord,
      copyLabel,
      documentFor,
    });
  })();

  if (typeof window === "object") window.PENECHO_DIAGRAM_RUNTIME = DIAGRAM_RUNTIME;
  if (typeof module === "object" && module.exports) module.exports = DIAGRAM_RUNTIME;
