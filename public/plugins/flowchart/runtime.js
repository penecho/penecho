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
    function responsiveMermaidSource(value, width, height) {
      const source = String(value || ""),
        directive = /^(\s*(?:(?:%%[^\n]*)\n\s*)*)(flowchart|graph)\s+(LR|RL|TB|TD|BT)\b/im.exec(source);
      if (!directive || /%%\s*penecho:fixed-layout\b/i.test(source)) return { source, direction:"", responsive:false };
      const connectors = source.match(/-->|---|-\.-?>|==>/g)?.length || 0,
        responsive = /%%\s*penecho:responsive\b/i.test(source) || connectors > 10;
      if (!responsive) return { source, direction:directive[3].toUpperCase(), responsive:false };
      const original = directive[3].toUpperCase(),
        horizontal = original === "RL" ? "RL" : "LR",
        vertical = original === "BT" ? "BT" : "TB",
        direction = width >= height * 1.35 ? horizontal : vertical,
        innerDirection = direction === horizontal ? "TB" : "LR";
      let responsiveDiagram = source.replace(directive[0], `${directive[1]}${directive[2]} ${direction}`);
      if (/%%\s*penecho:responsive\b/i.test(source))
        responsiveDiagram = responsiveDiagram.replace(/^(\s*direction\s+)(LR|RL|TB|TD|BT)\b/gim, `$1${innerDirection}`);
      return { source:responsiveDiagram, direction, responsive:true };
    }
    function responsiveDotSource(value, width, height) {
      const source = String(value || ""),
        fixed = /(?:\/\/|\/\*)\s*penecho:fixed-layout\b/i.test(source),
        edgeCount = source.match(/(?:->|--)/g)?.length || 0,
        responsive = !fixed && (/(?:\/\/|\/\*)\s*penecho:responsive\b/i.test(source) || edgeCount > 10);
      let originalDirection = "",
        transformed = "",
        index = 0,
        replaced = false,
        openingBrace = -1,
        braceDepth = 0,
        hasExplicitBackground = false;
      const directionPattern = /^(LR|RL|TB|TD|BT)$/i,
        isIdentifierStart = (character) => /[A-Za-z_]/.test(character || ""),
        isIdentifierPart = (character) => /[A-Za-z0-9_]/.test(character || "");
      while (index < source.length) {
        const character = source[index],
          next = source[index + 1];
        if (character === '"') {
          const start = index++;
          while (index < source.length) {
            if (source[index] === "\\") index += 2;
            else if (source[index++] === '"') break;
          }
          transformed += source.slice(start, index);
          continue;
        }
        if (character === "/" && next === "/") {
          const start = index;
          index = source.indexOf("\n", index + 2);
          if (index < 0) index = source.length;
          transformed += source.slice(start, index);
          continue;
        }
        if (character === "/" && next === "*") {
          const start = index,
            end = source.indexOf("*/", index + 2);
          index = end < 0 ? source.length : end + 2;
          transformed += source.slice(start, index);
          continue;
        }
        if (character === "#" && (index === 0 || source[index - 1] === "\n")) {
          const start = index;
          index = source.indexOf("\n", index + 1);
          if (index < 0) index = source.length;
          transformed += source.slice(start, index);
          continue;
        }
        if (character === "{") {
          if (openingBrace < 0) openingBrace = transformed.length;
          braceDepth += 1;
        } else if (character === "}") braceDepth = Math.max(0, braceDepth - 1);
        if (isIdentifierStart(character)) {
          const start = index++;
          while (isIdentifierPart(source[index])) index += 1;
          const identifier = source.slice(start, index),
            normalizedIdentifier = identifier.toLowerCase();
          if (normalizedIdentifier === "bgcolor" && braceDepth === 1) {
            let cursor = index;
            while (/\s/.test(source[cursor] || "")) cursor += 1;
            if (source[cursor] === "=") hasExplicitBackground = true;
          }
          if (normalizedIdentifier === "rankdir") {
            let cursor = index;
            while (/\s/.test(source[cursor] || "")) cursor += 1;
            if (source[cursor] === "=") {
              cursor += 1;
              while (/\s/.test(source[cursor] || "")) cursor += 1;
              const quote = source[cursor] === '"' ? '"' : "";
              if (quote) cursor += 1;
              const valueStart = cursor;
              while (/[A-Za-z]/.test(source[cursor] || "")) cursor += 1;
              const currentDirection = source.slice(valueStart, cursor).toUpperCase();
              if (directionPattern.test(currentDirection) && (!quote || source[cursor] === quote)) {
                if (!originalDirection) originalDirection = currentDirection;
                if (responsive) {
                  const horizontal = originalDirection === "RL" ? "RL" : "LR",
                    vertical = originalDirection === "BT" ? "BT" : "TB",
                    direction = width >= height * 1.35 ? horizontal : vertical;
                  transformed += source.slice(start, valueStart) + direction + quote;
                  index = cursor + (quote ? 1 : 0);
                  replaced = true;
                  continue;
                }
              }
            }
          }
          transformed += identifier;
          continue;
        }
        transformed += character;
        index += 1;
      }
      const horizontal = originalDirection === "RL" ? "RL" : "LR",
        vertical = originalDirection === "BT" ? "BT" : "TB",
        direction = responsive ? width >= height * 1.35 ? horizontal : vertical : originalDirection;
      if (!hasExplicitBackground && openingBrace >= 0)
        transformed = `${transformed.slice(0, openingBrace + 1)}\n  graph [bgcolor="transparent"];${transformed.slice(openingBrace + 1)}`;
      if (responsive && !replaced && openingBrace >= 0)
        transformed = `${transformed.slice(0, openingBrace + 1)}\n  graph [rankdir=${direction}];${transformed.slice(openingBrace + 1)}`;
      return { source:transformed, direction, responsive };
    }
    function vegaLiteSpecWithDefaultBackground(value) {
      const spec = typeof value === "string" ? JSON.parse(value) : value;
      if (!spec || typeof spec !== "object" || Array.isArray(spec)) return spec;
      const hasBackground = Object.prototype.hasOwnProperty.call(spec, "background")
        || spec.config && typeof spec.config === "object" && Object.prototype.hasOwnProperty.call(spec.config, "background");
      return hasBackground ? spec : { ...spec, background:"transparent" };
    }
    function frameRuntime(config, responsiveMermaidSource, responsiveDotSource, vegaLiteSpecWithDefaultBackground) {
      const stage = document.querySelector("#diagram-stage"),
        status = document.querySelector("#diagram-status"),
        root = document.querySelector(".pd-root"),
        source = new TextDecoder().decode(Uint8Array.from(atob(config.sourceBase64), (character) => character.charCodeAt(0))),
        format = config.sourceFormat;
      let resizeRender = null;
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
        const { default:mermaid } = await import("https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.esm.min.mjs"),
          initial = responsiveMermaidSource(source, stage.clientWidth, stage.clientHeight);
        mermaid.initialize({
          startOnLoad:false,
          securityLevel:"strict",
          theme:"base",
          themeVariables:{ background:"transparent" },
          ...(initial.responsive ? { flowchart:{ defaultRenderer:"elk" } } : {}),
        });
        let renderedDirection = "",
          renderVersion = 0;
        const paint = async () => {
            const next = responsiveMermaidSource(source, stage.clientWidth, stage.clientHeight),
              version = ++renderVersion;
            if (next.direction && next.direction === renderedDirection && stage.querySelector("svg")) return;
            const rendered = await mermaid.render(`penecho-${Math.random().toString(36).slice(2)}`, next.source);
            if (version !== renderVersion) return;
            stage.innerHTML = rendered.svg;
            rendered.bindFunctions?.(stage);
            const svg = stage.querySelector("svg");
            if (svg) {
              svg.removeAttribute("width");
              svg.removeAttribute("height");
              svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
              svg.style.width = "100%";
              svg.style.height = "100%";
              svg.style.maxWidth = "100%";
              svg.style.maxHeight = "100%";
            }
            renderedDirection = next.direction;
            notify();
          };
        await paint();
        resizeRender = () => void paint().catch(() => {});
      }
      async function renderDot() {
        const { instance } = await import("https://cdn.jsdelivr.net/npm/@viz-js/viz@3.9.0/lib/viz-standalone.mjs"),
          viz = await instance(),
          initial = responsiveDotSource(source, stage.clientWidth, stage.clientHeight),
          layouts = [];
        const addLayout = (next) => {
            if (layouts.some((layout) => layout.direction === next.direction)) return;
            const svg = viz.renderSVGElement(next.source),
              viewBox = svg.getAttribute("viewBox")?.trim().split(/[ ,]+/).map(Number),
              intrinsicWidth = viewBox?.length === 4 && Number.isFinite(viewBox[2]) && viewBox[2] > 0
                ? viewBox[2]
                : Number.parseFloat(svg.getAttribute("width")) || 1,
              intrinsicHeight = viewBox?.length === 4 && Number.isFinite(viewBox[3]) && viewBox[3] > 0
                ? viewBox[3]
                : Number.parseFloat(svg.getAttribute("height")) || 1;
            svg.removeAttribute("width");
            svg.removeAttribute("height");
            svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
            svg.style.width = "100%";
            svg.style.height = "100%";
            svg.style.maxWidth = "100%";
            svg.style.maxHeight = "100%";
            layouts.push({ svg, direction:next.direction, intrinsicWidth, intrinsicHeight });
          },
          paint = () => {
            const width = Math.max(1, stage.clientWidth),
              height = Math.max(1, stage.clientHeight),
              preferred = responsiveDotSource(source, width, height).direction,
              best = layouts.reduce((winner, layout) => {
                const scale = Math.min(width / layout.intrinsicWidth, height / layout.intrinsicHeight),
                  winnerScale = winner ? Math.min(width / winner.intrinsicWidth, height / winner.intrinsicHeight) : -1;
                return scale > winnerScale + .0001 || Math.abs(scale - winnerScale) <= .0001 && layout.direction === preferred ? layout : winner;
              }, null);
            if (best && stage.firstElementChild !== best.svg) {
              stage.replaceChildren(best.svg);
              notify();
            }
          };
        if (initial.responsive) {
          const horizontal = responsiveDotSource(source, 2, 1),
            vertical = responsiveDotSource(source, 1, 2);
          for (const next of [horizontal, vertical]) {
            try { addLayout(next); } catch {}
          }
        }
        if (!layouts.length) addLayout(initial);
        paint();
        resizeRender = paint;
      }
      async function renderBpmn() {
        await Promise.all([
          loadStyle("https://cdn.jsdelivr.net/npm/bpmn-js@17.11.1/dist/assets/diagram-js.css"),
          loadStyle("https://cdn.jsdelivr.net/npm/bpmn-js@17.11.1/dist/assets/bpmn-font/css/bpmn.css"),
          loadScript("https://cdn.jsdelivr.net/npm/bpmn-js@17.11.1/dist/bpmn-viewer.development.js"),
        ]);
        if (typeof globalThis.BpmnJS !== "function") throw Error("BPMN renderer did not initialize");
        stage.style.background = "transparent";
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
        const result = await globalThis.vegaEmbed(stage, vegaLiteSpecWithDefaultBackground(parseJson()), { actions:false, renderer:"svg" });
        resizeRender = () => result.view?.resize?.().runAsync?.().then(notify).catch(() => {});
      }
      function wgs84ToGcj02(lng, lat) {
        if (lng < 72.004 || lng > 137.8347 || lat < .8293 || lat > 55.8271) return [lng, lat];
        const pi = Math.PI,
          a = 6378245,
          eccentricity = .006693421622965943,
          transformLat = (x, y) => {
            let value = -100 + 2 * x + 3 * y + .2 * y * y + .1 * x * y + .2 * Math.sqrt(Math.abs(x));
            value += (20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2 / 3;
            value += (20 * Math.sin(y * pi) + 40 * Math.sin(y / 3 * pi)) * 2 / 3;
            return value + (160 * Math.sin(y / 12 * pi) + 320 * Math.sin(y * pi / 30)) * 2 / 3;
          },
          transformLng = (x, y) => {
            let value = 300 + x + 2 * y + .1 * x * x + .1 * x * y + .1 * Math.sqrt(Math.abs(x));
            value += (20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2 / 3;
            value += (20 * Math.sin(x * pi) + 40 * Math.sin(x / 3 * pi)) * 2 / 3;
            return value + (150 * Math.sin(x / 12 * pi) + 300 * Math.sin(x / 30 * pi)) * 2 / 3;
          },
          latitudeOffset = transformLat(lng - 105, lat - 35),
          longitudeOffset = transformLng(lng - 105, lat - 35),
          radianLatitude = lat / 180 * pi,
          magic = 1 - eccentricity * Math.sin(radianLatitude) ** 2,
          rootMagic = Math.sqrt(magic),
          adjustedLat = latitudeOffset * 180 / ((a * (1 - eccentricity) / (magic * rootMagic)) * pi),
          adjustedLng = longitudeOffset * 180 / (a / rootMagic * Math.cos(radianLatitude) * pi);
        return [lng + adjustedLng, lat + adjustedLat];
      }
      function mapGeoJsonCoordinates(value, transform) {
        if (!value || typeof value !== "object") return value;
        if (Array.isArray(value)) {
          if (value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
            const [lng, lat] = transform(value[0], value[1]);
            return [lng, lat, ...value.slice(2)];
          }
          return value.map((item) => mapGeoJsonCoordinates(item, transform));
        }
        const mapped = { ...value };
        if (value.coordinates) mapped.coordinates = mapGeoJsonCoordinates(value.coordinates, transform);
        if (Array.isArray(value.geometries)) mapped.geometries = value.geometries.map((item) => mapGeoJsonCoordinates(item, transform));
        if (value.geometry) mapped.geometry = mapGeoJsonCoordinates(value.geometry, transform);
        if (Array.isArray(value.features)) mapped.features = value.features.map((item) => mapGeoJsonCoordinates(item, transform));
        return mapped;
      }
      async function renderGeoJson() {
        await Promise.all([
          loadStyle("https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css"),
          loadScript("https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"),
        ]);
        if (!globalThis.L?.map) throw Error("GeoJSON renderer did not initialize");
        const geoJson = parseJson(),
          noBasemap = geoJson && typeof geoJson === "object" && !Array.isArray(geoJson) && geoJson.basemap === "none",
          map = globalThis.L.map(stage, { attributionControl:true, zoomControl:true, preferCanvas:true }),
          vectorOptions = {
            style:{ color:"#2563eb", weight:3, opacity:.9, fillColor:"#93c5fd", fillOpacity:.22 },
            pointToLayer:(_feature, latlng) => globalThis.L.circleMarker(latlng, {
              radius:7, color:"#1d4ed8", weight:2, fillColor:"#60a5fa", fillOpacity:.85,
            }),
          },
          mainlandBrowser = /^zh-CN\b/i.test(navigator.language || "")
            || (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone === "Asia/Shanghai"; } catch { return false; } })(),
          google = {
            id:"google",
            url:"https://mt1.google.com/vt/lyrs=m&hl=en&x={x}&y={y}&z={z}",
            options:{ maxZoom:20, attribution:'&copy; <a href="https://maps.google.com/">Google</a>' },
          },
          amap = {
            id:"amap",
            url:"https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}",
            options:{ subdomains:"1234", maxZoom:20, attribution:'&copy; <a href="https://www.amap.com/">AutoNavi</a>' },
          },
          providers = mainlandBrowser ? [amap, google] : [google, amap];
        map.attributionControl.setPrefix(false);
        let vectorLayer = null,
          vectorUsesGcj = null,
          baseLayer = null,
          providerAttempt = 0;
        const paintVector = (useGcj) => {
            if (vectorLayer && vectorUsesGcj === useGcj) return vectorLayer.getBounds();
            if (vectorLayer) map.removeLayer(vectorLayer);
            vectorLayer = globalThis.L.geoJSON(useGcj ? mapGeoJsonCoordinates(geoJson, wgs84ToGcj02) : geoJson, vectorOptions).addTo(map);
            vectorLayer.bringToFront();
            vectorUsesGcj = useGcj;
            return vectorLayer.getBounds();
          },
          initialBounds = paintVector(false);
        if (initialBounds.isValid()) map.fitBounds(initialBounds, { padding:[24, 24] });
        else map.setView([0, 0], 2);
        const activateProvider = (index) => {
          const attempt = ++providerAttempt;
          if (baseLayer) {
            map.removeLayer(baseLayer);
            baseLayer = null;
          }
          if (index >= providers.length) {
            paintVector(false);
            notify();
            return;
          }
          const provider = providers[index],
            layer = globalThis.L.tileLayer(provider.url, provider.options);
          baseLayer = layer;
          paintVector(provider.id === "amap");
          vectorLayer.bringToFront();
          let loaded = false,
            errors = 0,
            timer = setTimeout(() => {
              if (!loaded && attempt === providerAttempt) activateProvider(index + 1);
            }, 4500);
          layer.on("tileload", () => {
            if (attempt !== providerAttempt) return;
            loaded = true;
            clearTimeout(timer);
            vectorLayer?.bringToFront();
            notify();
          });
          layer.on("tileerror", () => {
            errors += 1;
            if (!loaded && errors >= 2 && attempt === providerAttempt) {
              clearTimeout(timer);
              activateProvider(index + 1);
            }
          });
          layer.addTo(map);
          vectorLayer.bringToFront();
        };
        if (noBasemap) {
          stage.style.background = "transparent";
          notify();
        } else activateProvider(0);
        resizeRender = () => {
          map.invalidateSize(false);
          const bounds = vectorLayer?.getBounds();
          if (bounds?.isValid()) map.fitBounds(bounds, { padding:[24, 24], animate:false });
        };
      }
      async function renderSmiles() {
        await loadScript("https://cdn.jsdelivr.net/npm/smiles-drawer@2.1.7/dist/smiles-drawer.min.js");
        if (!globalThis.SmilesDrawer?.parse || typeof globalThis.SmilesDrawer.SvgDrawer !== "function") throw Error("SMILES renderer did not initialize");
        const tree = await new Promise((resolve, reject) => globalThis.SmilesDrawer.parse(source.trim(), resolve, reject)),
          svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"),
          width = Math.max(320,stage.clientWidth),
          height = Math.max(220,stage.clientHeight);
        svg.setAttribute("xmlns","http://www.w3.org/2000/svg");
        svg.setAttribute("preserveAspectRatio","xMidYMid meet");
        new globalThis.SmilesDrawer.SvgDrawer({ width, height, bondThickness:2, padding:30, compactDrawing:config.compactDrawing===true })
          .draw(tree,svg,"light",null,false,[]);
        svg.removeAttribute("width");
        svg.removeAttribute("height");
        svg.style.width="100%";
        svg.style.height="100%";
        svg.style.maxWidth="100%";
        svg.style.maxHeight="100%";
        svg.style.background="transparent";
        stage.replaceChildren(svg);
      }
      async function renderCytoscape() {
        await loadScript("https://cdn.jsdelivr.net/npm/cytoscape@3.30.4/dist/cytoscape.min.js");
        if (typeof globalThis.cytoscape !== "function") throw Error("Cytoscape renderer did not initialize");
        stage.style.background = "transparent";
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
        showStatus(`${config.label} is still loading. The source remains available from Copy.`);
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
            resizeRender?.();
            notify();
          }, 80);
        }).observe(stage);
      }
    }
    function documentFor({ sourceFormat, source, title, diagramKind }) {
      const format = formatRecord(sourceFormat);
      if (!format || typeof source !== "string" || !source.trim() || new TextEncoder().encode(source).length > 100 * 1024) return "";
      const config = {
        sourceFormat:format.id,
        label:format.label,
        sourceBase64:utf8Base64(source),
        compactDrawing:format.id === "smiles" && String(diagramKind || "").trim().toLowerCase() === "molecular-structure-compact",
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
    .pd-stage{position:relative;min-width:0;min-height:0;width:100%;height:100%;overflow:hidden;background:transparent}
    .pd-stage>.djs-container,.pd-stage>.vega-embed,.pd-stage>.vega-embed>div{background:transparent}
    .pd-stage>svg,.pd-stage>.vega-embed,.pd-stage>.vega-embed>div{display:block;width:100%;height:100%;max-width:100%;max-height:100%}
    .pd-stage>canvas{display:block;max-width:100%;max-height:100%}
    .pd-status{position:absolute;inset:0;display:grid;place-items:center;padding:24px;text-align:center;font-size:clamp(15px,2.1cqw,24px);line-height:1.4;color:var(--pd-muted,#5f6b7a);background:rgba(255,255,255,.94)}
    .pd-status[hidden]{display:none}
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
  <script type="module">(${frameRuntime.toString()})(${scriptValue(config)},${responsiveMermaidSource.toString()},${responsiveDotSource.toString()},${vegaLiteSpecWithDefaultBackground.toString()});</script>
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
      responsiveMermaidSource,
      responsiveDotSource,
      vegaLiteSpecWithDefaultBackground,
      documentFor,
    });
  })();

  if (typeof window === "object") window.PENECHO_DIAGRAM_RUNTIME = DIAGRAM_RUNTIME;
  if (typeof module === "object" && module.exports) module.exports = DIAGRAM_RUNTIME;
