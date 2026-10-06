"""Real-browser verification of Widget capture paths (lasso classification,
Canvas/selection/Widget downloads, cancelled captures, changed Widgets and the
Canvas AI atlas).

Usage (Python Playwright with Chromium):
  NODE_ENV=test PENECHO_TEST_OPEN_ACCESS=1 PENECHO_STATE_DIR=/tmp/pe-state \
    PENECHO_CONFIG_FILE=/tmp/pe-state/config.env HOST=127.0.0.1 PORT=4100 \
    PENECHO_JEVISION_ENABLED=false node server.js &
  python3 scripts/verify-widget-capture.py 4100 fixed [output-dir]

The PenEchoLLM transport is intercepted; no model is contacted. Every number in
the printed JSON is measured from the actual image the app produced.
"""
import base64, io, json, sys, time
from playwright.sync_api import sync_playwright
from PIL import Image

PORT = int(sys.argv[1]); LABEL = sys.argv[2]
OUTPUT_DIR = sys.argv[3] if len(sys.argv) > 3 else "."
URL = f"http://127.0.0.1:{PORT}/"
HOOK = "\nwindow.__app=code=>eval(code);\n})();\n"

RED_WIDGET = """<!doctype html><html><head><style>html,body{margin:0;height:100%}
.b{position:absolute;inset:0;background:#d01818;color:#fff;font:700 60px sans-serif;display:flex;align-items:center;justify-content:center}</style></head>
<body><div class=b id=b>RED</div><script>SCRIPT</script></body></html>"""
HEAVY_WIDGET = """<!doctype html><html><head><style>html,body{margin:0}.c{display:inline-block;width:18px;height:18px;margin:1px;background:#1060d0;border-radius:4px;box-shadow:0 1px 2px #0004}</style></head>
<body style="background:#1060d0">SPANS</body></html>""".replace("SPANS", "<span class=c></span>" * 9000)

def widget(id, x, y, w, h, html, title="W"):
    return {"id": id, "widgetType": "html_widget", "pluginId": "general", "x": x, "y": y, "w": w, "h": h,
            "contentW": max(300, w), "contentH": max(200, h), "title": title, "refreshSeconds": 0, "html": html}

def decode(data_url):
    return Image.open(io.BytesIO(base64.b64decode(data_url.split(",", 1)[1]))).convert("RGB")

def frac(img, box, pred):
    x0, y0, x1, y1 = [int(v) for v in box]
    px = img.load(); total = hit = 0
    for yy in range(max(0, y0), min(img.height, y1), 3):
        for xx in range(max(0, x0), min(img.width, x1), 3):
            total += 1; hit += pred(px[xx, yy])
    return round(hit / max(1, total), 3)

red = lambda p: p[0] > 150 and p[1] < 90 and p[2] < 90
blue = lambda p: p[2] > 150 and p[0] < 90
white = lambda p: min(p) > 235

def main():
    report = {"label": LABEL, "scenarios": {}}
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1400, "height": 900}, accept_downloads=True)
        page = ctx.new_page()
        logs = []
        page.on("console", lambda m: logs.append(m.text[:300]) if ("snapshot" in m.text.lower() or m.type == "error") else None)
        def route_app(route):
            body = route.fetch().text()
            body = body[: body.rstrip().rfind("})();")] + HOOK
            route.fulfill(body=body, content_type="application/javascript")
        page.route("**/app.js*", route_app)
        suggests = []
        def route_suggest(route):
            if route.request.url.endswith("/status"):
                return route.fulfill(json={"configured": True, "ok": True})
            body = json.loads(route.request.post_data or "{}")
            suggests.append(body)
            route.fulfill(json={"ok": True, "answers": {"kind": {"type": "choice", "choice": "notes", "confidence": .9, "probabilities": {"notes": 1}},
                                                       "action": {"type": "choice", "choice": "explain", "confidence": .9, "probabilities": {"explain": .9, "none": .1}}}})
        page.route("**/api/suggest**", route_suggest)
        page.goto(URL)
        page.wait_for_function("typeof window.__app === 'function'")
        app = lambda code: page.evaluate("code => window.__app(code)", code)
        aapp = lambda code: page.evaluate("code => window.__app(code)", "(async()=>{" + code + "})()")
        aapp("await canvasDocumentsReady(); await loadCanvasSettings(); document.querySelector('#tourSkip')?.click(); document.querySelector('#changelogClose')?.click();"
             "state.auto=false; state.scale=1; state.panX=0; state.panY=0; setCanvasMode('pen'); return true;")
        page.wait_for_timeout(1000)

        def reset(widgets):
            ids = aapp(f"state.selection=null; syncSelectionSuggestions(); restoreWidgets({json.dumps(widgets)}); positionWidgets(); render(); return state.widgets.map(w=>w.id);")
        def wait_ready(ids, timeout=8):
            end = time.time() + timeout
            while time.time() < end:
                if app(f"{json.dumps(ids)}.every(id=>state.widgets.find(w=>w.id===id)?.hostReady)"):
                    return True
                page.wait_for_timeout(100)
            return False

        # A. Lasso classification over a visible Widget that was never captured.
        #    The triangle lasso's bounding box also covers a blue Widget that
        #    lies outside the polygon: it must stay white.
        reset([widget("widget-1", 200, 150, 400, 300, RED_WIDGET.replace("SCRIPT", "")), widget("widget-2", 520, 380, 120, 100, HEAVY_WIDGET.replace("<span class=c></span>" * 9000, ""))])
        wait_ready(["widget-1", "widget-2"]); page.wait_for_timeout(600)
        suggests.clear()
        before = app("({snap:Boolean(state.widgets.find(w=>w.id==='widget-1').snapshotImage)})")
        app("smartSuggest.enabled=true; smartSuggest.available=true; setCanvasMode('select');"
            "captureSelection([{x:150,y:100},{x:700,y:100},{x:150,y:520}]); syncSelectionSuggestions(); true")
        t0 = time.time()
        while time.time() - t0 < 15 and not suggests:
            page.wait_for_timeout(100)
        a = {"cachedBefore": before["snap"], "requestSent": bool(suggests), "seconds": round(time.time() - t0, 2)}
        if suggests:
            img = decode(suggests[0]["image"]); a["mode"] = suggests[0]["mode"]; a["size"] = img.size
            sx = img.width / 550; sy = img.height / 420
            # Red widget region inside the polygon (upper-left part of the widget).
            a["redInsideLasso"] = frac(img, ((200 - 150) * sx, (150 - 100) * sy, (380 - 150) * sx, (300 - 100) * sy), red)
            # Blue widget lies in the bbox but outside the polygon.
            a["outsideLassoWhite"] = frac(img, ((540 - 150) * sx, (400 - 100) * sy, (630 - 150) * sx, (470 - 100) * sy), white)
            img.save(f"{OUTPUT_DIR}/{LABEL}-A-lasso.png")
        a["status"] = app("JSON.stringify(smartSuggest.status)")
        report["scenarios"]["A_lasso_uncaptured_widget"] = a
        app("state.selection=null; syncSelectionSuggestions(); setCanvasMode('pen'); true")

        # B. Lasso classification where one of two Widgets cannot be captured.
        reset([widget("widget-1", 200, 150, 300, 250, RED_WIDGET.replace("SCRIPT", "")), widget("widget-2", 520, 150, 200, 250, RED_WIDGET.replace("SCRIPT", ""))])
        wait_ready(["widget-1", "widget-2"]); page.wait_for_timeout(500)
        app("unmountWidget(state.widgets.find(w=>w.id==='widget-2')); true")
        suggests.clear()
        app("smartSuggest.enabled=true; smartSuggest.available=true; setCanvasMode('select');"
            "captureSelection([{x:180,y:130},{x:740,y:130},{x:740,y:420},{x:180,y:420}]); syncSelectionSuggestions(); true")
        page.wait_for_timeout(6000)
        b = {"requestSent": bool(suggests), "status": app("JSON.stringify(smartSuggest.status)")}
        if suggests:
            img = decode(suggests[0]["image"]); sx = img.width / 560; sy = img.height / 290
            b["missingWidgetAreaWhite"] = frac(img, ((540 - 180) * sx, (170 - 130) * sy, (700 - 180) * sx, (380 - 130) * sy), white)
        report["scenarios"]["B_lasso_one_widget_fails"] = b
        app("state.selection=null; syncSelectionSuggestions(); setCanvasMode('pen'); true")

        # C. Canvas PNG export with a far-away Widget that was never initialised.
        reset([widget("widget-1", 100, 100, 300, 200, RED_WIDGET.replace("SCRIPT", "")), widget("widget-2", 9000, 9000, 300, 200, RED_WIDGET.replace("SCRIPT", ""))])
        wait_ready(["widget-1", "widget-2"]); page.wait_for_timeout(500)
        far_init = app("state.widgets.find(w=>w.id==='widget-2').initialized")
        t0 = time.time()
        try:
            with page.expect_download(timeout=30000) as dl:
                app("void exportCanvasPng(); true")
            path = dl.value.path(); img = Image.open(path).convert("RGB")
            c = {"farInitializedBefore": far_init, "downloaded": True, "seconds": round(time.time() - t0, 2), "size": img.size}
            # Count red pixels: two widgets, each 300x200 world px at 1.5x.
            # The near Widget sits in the top-left corner, the far one bottom-right.
            c["nearWidgetRed"] = frac(img, (0, 0, img.width * .1, img.height * .1), red) > 0
            c["farWidgetRed"] = frac(img, (img.width * .9, img.height * .9, img.width, img.height), red) > 0
            img.thumbnail((800, 800)); img.save(f"{OUTPUT_DIR}/{LABEL}-C-export.png")
        except Exception as error:
            c = {"farInitializedBefore": far_init, "downloaded": False, "error": str(error)[:200], "status": app("document.querySelector('#status, .status')?.textContent || ''")}
        c["statusText"] = app("(document.querySelector('[data-status], #statusText, .status-text, #status')||{}).textContent||''")[:200]
        report["scenarios"]["C_canvas_export_offscreen_widget"] = c

        # D. A cancelled capture must not make the next capture fail (host busy).
        reset([widget("widget-1", 100, 100, 900, 700, HEAVY_WIDGET)])
        wait_ready(["widget-1"]); page.wait_for_timeout(800)
        d = aapp("""const w=state.widgets.find(w=>w.id==='widget-1'); let t0=performance.now();
          await requestWidgetSnapshot(w, 20000, true, null); const fullMs=Math.round(performance.now()-t0);
          w.contentVersion++; t0=performance.now();
          // A caller that gives up early (short deadline), followed at once by a normal request.
          let first; try { await requestWidgetSnapshot(w, 300, true, null); first='resolved'; } catch(e) { first='rejected:'+(e.code||e.message); }
          let second; try { const img=await requestWidgetSnapshot(w, 20000, true, null); second='ok '+img.width+'x'+img.height; } catch(e) { second='failed:'+(e.code||'')+' '+e.message; }
          return {captureMs:fullMs, first, second, ms:Math.round(performance.now()-t0)};""")
        report["scenarios"]["D_capture_after_cancelled_capture"] = d

        # E. Content that changes after an earlier snapshot is recaptured.
        changing = RED_WIDGET.replace("SCRIPT", "setTimeout(()=>{document.getElementById('b').style.background='#1060d0';parent.postMessage({type:'penecho-widget-updated'},'*');},1500)")
        reset([widget("widget-1", 200, 150, 400, 300, changing)])
        wait_ready(["widget-1"]); page.wait_for_timeout(300)
        aapp("await requestWidgetSnapshot(state.widgets.find(w=>w.id==='widget-1'),20000,true); return true")
        page.wait_for_timeout(2500)
        suggests.clear()
        app("smartSuggest.enabled=true; smartSuggest.available=true; setCanvasMode('select');"
            "captureSelection([{x:180,y:130},{x:620,y:130},{x:620,y:470},{x:180,y:470}]); syncSelectionSuggestions(); true")
        t0 = time.time()
        while time.time() - t0 < 12 and not suggests:
            page.wait_for_timeout(100)
        e = {"requestSent": bool(suggests)}
        if suggests:
            img = decode(suggests[0]["image"])
            e["blueAfterChange"] = frac(img, (img.width * .2, img.height * .2, img.width * .8, img.height * .8), blue)
            e["staleRed"] = frac(img, (img.width * .2, img.height * .2, img.width * .8, img.height * .8), red)
        report["scenarios"]["E_changed_widget_recaptured"] = e
        app("state.selection=null; syncSelectionSuggestions(); setCanvasMode('pen'); true")

        # F. Widget PNG download (full content) is not blank.
        reset([widget("widget-1", 200, 150, 400, 300, RED_WIDGET.replace("SCRIPT", ""))])
        wait_ready(["widget-1"]); page.wait_for_timeout(400)
        try:
            with page.expect_download(timeout=30000) as dl:
                app("void downloadWidgetImage(state.widgets.find(w=>w.id==='widget-1')); true")
            img = Image.open(dl.value.path()).convert("RGB")
            report["scenarios"]["F_widget_download"] = {"downloaded": True, "size": img.size, "red": frac(img, (0, 0, img.width, img.height), red), "url": dl.value.url[:12]}
        except Exception as error:
            report["scenarios"]["F_widget_download"] = {"downloaded": False, "error": str(error)[:200]}

        # G. Selection PNG download keeps the lasso exterior white and the Widget.
        reset([widget("widget-1", 200, 150, 400, 300, RED_WIDGET.replace("SCRIPT", "")), widget("widget-2", 520, 380, 120, 100, HEAVY_WIDGET.replace("<span class=c></span>" * 9000, ""))])
        wait_ready(["widget-1", "widget-2"]); page.wait_for_timeout(500)
        app("setCanvasMode('select'); captureSelection([{x:150,y:100},{x:700,y:100},{x:150,y:520}]); syncSelectionSuggestions(); true")
        try:
            with page.expect_download(timeout=30000) as dl:
                app("void exportSelectionPng({selection:state.selection, box:state.selection.box, selectionKey:`selection:${smartSuggest.selectionVersion}`}); true")
            img = Image.open(dl.value.path()).convert("RGB"); sx = img.width / 550; sy = img.height / 420
            report["scenarios"]["G_selection_download"] = {"downloaded": True, "redInsideLasso": frac(img, ((200 - 150) * sx, (150 - 100) * sy, (380 - 150) * sx, (300 - 100) * sy), red),
                "outsideLassoWhite": frac(img, ((540 - 150) * sx, (400 - 100) * sy, (630 - 150) * sx, (470 - 100) * sy), white)}
        except Exception as error:
            report["scenarios"]["G_selection_download"] = {"downloaded": False, "error": str(error)[:200], "status": app("document.body.innerText.match(/Export[^\\n]*/)?.[0]||''")}
        app("state.selection=null; syncSelectionSuggestions(); setCanvasMode('pen'); true")

        # H. Canvas AI viewport image when one Widget cannot be captured: the
        #    request still goes out, but the Widget is a labelled placeholder.
        reset([widget("widget-1", 200, 150, 400, 300, RED_WIDGET.replace("SCRIPT", "")), widget("widget-2", 700, 150, 400, 300, RED_WIDGET.replace("SCRIPT", ""))])
        wait_ready(["widget-1", "widget-2"]); page.wait_for_timeout(500)
        app("unmountWidget(state.widgets.find(w=>w.id==='widget-2')); true")
        h = aapp("""const region={x:150,y:100,w:1000,h:400};
          try { if (typeof ensureWidgetSnapshots==='function') await ensureWidgetSnapshots(capturableWidgets(region),{timeoutMs:3000}); else await prepareVisibleWidgetSnapshots(region); } catch(e) {}
          const plan=planViewportImage(region,false,region); const packed=buildViewportImage([],region,false,plan,region); return {image:packed.atlasImage, src:packed.sourceRect};""")
        img = decode(h["image"]); src = h["src"]; sx = img.width / src["w"]; sy = img.height / src["h"]
        gray = lambda p: abs(p[0]-p[1]) < 14 and abs(p[1]-p[2]) < 14 and 200 < p[0] < 236
        report["scenarios"]["H_ai_atlas_unavailable_widget"] = {
            "capturedWidgetRed": frac(img, ((250 - src["x"]) * sx, (200 - src["y"]) * sy, (550 - src["x"]) * sx, (400 - src["y"]) * sy), lambda p: p[0] > p[1] + 40),
            "missingWidgetPlaceholderGray": frac(img, ((750 - src["x"]) * sx, (200 - src["y"]) * sy, (1050 - src["x"]) * sx, (400 - src["y"]) * sy), gray),
            "missingWidgetWhite": frac(img, ((750 - src["x"]) * sx, (200 - src["y"]) * sy, (1050 - src["x"]) * sx, (400 - src["y"]) * sy), white)}
        img.save(f"{OUTPUT_DIR}/{LABEL}-H-atlas.png")

        report["consoleSnapshotLines"] = logs[-12:]
        browser.close()
    print(json.dumps(report, indent=1))

main()
