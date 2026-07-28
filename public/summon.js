"use strict";
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PENECHO_SUMMON = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  // Fantasy "summoning" overlay shown while the AI request is in flight.
  // Pure CSS animation; JS only builds the DOM, rotates phrase/tip text,
  // and keeps the overlay glued to its world-space anchor while panning.
  const EFFECTS = ["rift", "vortex", "array", "script", "flame"],
    SCRIPT_GLYPHS = "灵玄虚念衍化聚凝识慧光尘星墨",
    ARRAY_GLYPHS = ["✦", "✧", "❖", "◈", "⬖", "✵", "✺", "❂", "✴", "✶", "❋", "✹"],
    PHRASE_KEYS = ["summonPhrase1", "summonPhrase2", "summonPhrase3", "summonPhrase4", "summonPhrase5", "summonPhrase6", "summonPhrase7", "summonPhrase8"],
    TIP_KEYS = ["summonTip1", "summonTip2", "summonTip3", "summonTip4", "summonTip5", "summonTip6", "summonTip7", "summonTip8", "summonTip9", "summonTip10"],
    PHRASE_MS = 3600,
    TIP_MS = 9200,
    RIFT_PATH = "M6 64 L26 52 L44 68 L63 48 L84 66 L103 46 L124 67 L144 50 L164 63 L194 56";

  function span(className, text) {
    const node = document.createElement("span");
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function div(className) {
    const node = document.createElement("div");
    node.className = className;
    return node;
  }

  function buildStage(effect) {
    const stage = div(`summon-stage fx-${effect}`),
      aura = div("summon-aura");
    aura.setAttribute("aria-hidden", "true");
    stage.appendChild(aura);
    if (effect === "rift") {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "rift-svg");
      svg.setAttribute("viewBox", "0 0 200 110");
      svg.setAttribute("aria-hidden", "true");
      for (const cls of ["rift-glow", "rift-crack"]) {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("class", cls);
        path.setAttribute("d", RIFT_PATH);
        path.setAttribute("fill", "none");
        svg.appendChild(path);
      }
      stage.appendChild(svg);
      for (let i = 1; i <= 5; i++) stage.appendChild(span(`rift-spark spark-${i}`)).setAttribute("aria-hidden", "true");
    } else if (effect === "vortex") {
      for (const [ring, count, radius] of [["ring-a", 9, 44], ["ring-b", 6, 26]]) {
        const ringNode = div(`vortex-ring ${ring}`);
        ringNode.setAttribute("aria-hidden", "true");
        for (let i = 0; i < count; i++) {
          const dot = span("vortex-dot");
          dot.style.transform = `rotate(${(360 / count) * i}deg) translateY(-${radius}px)`;
          ringNode.appendChild(dot);
        }
        stage.appendChild(ringNode);
      }
      const core = div("vortex-core");
      core.setAttribute("aria-hidden", "true");
      stage.appendChild(core);
    } else if (effect === "array") {
      for (const [ring, count, radius, glyphs] of [["ring-outer", 12, 52, true], ["ring-inner", 8, 32, true]]) {
        const ringNode = div(`array-ring ${ring}`);
        ringNode.setAttribute("aria-hidden", "true");
        for (let i = 0; i < count; i++) {
          const glyph = span("array-glyph", ARRAY_GLYPHS[i % ARRAY_GLYPHS.length]);
          glyph.style.transform = `rotate(${(360 / count) * i}deg) translateY(-${radius}px)`;
          ringNode.appendChild(glyph);
        }
        stage.appendChild(ringNode);
      }
      const core = div("array-core");
      core.setAttribute("aria-hidden", "true");
      stage.appendChild(core);
    } else if (effect === "script") {
      for (let c = 1; c <= 5; c++) {
        const column = div(`script-column column-${c}`);
        column.setAttribute("aria-hidden", "true");
        for (let i = 0; i < 4; i++) column.appendChild(span("script-glyph", SCRIPT_GLYPHS[(c * 3 + i * 5) % SCRIPT_GLYPHS.length]));
        stage.appendChild(column);
      }
    } else if (effect === "flame") {
      const body = div("flame-body");
      body.setAttribute("aria-hidden", "true");
      for (let i = 1; i <= 3; i++) body.appendChild(span(`flame-tongue tongue-${i}`));
      stage.appendChild(body);
      for (let i = 1; i <= 5; i++) stage.appendChild(span(`flame-ember ember-${i}`)).setAttribute("aria-hidden", "true");
    }
    const phrase = div("summon-phrase"),
      tip = div("summon-tip");
    stage.appendChild(phrase);
    stage.appendChild(tip);
    return { stage, phrase, tip };
  }

  function create(options) {
    const layer = options.layer,
      t = options.t,
      toScreen = options.toScreen;
    let effect = EFFECTS[0],
      anchor = null,
      stage = null,
      phraseEl = null,
      tipEl = null,
      phraseIndex = Math.floor(Math.random() * PHRASE_KEYS.length),
      tipIndex = Math.floor(Math.random() * TIP_KEYS.length),
      phraseTimer = 0,
      tipTimer = 0,
      rafId = 0,
      hideTimer = 0;

    function applyText() {
      if (phraseEl) phraseEl.textContent = t(PHRASE_KEYS[phraseIndex % PHRASE_KEYS.length]);
      if (tipEl) tipEl.textContent = t(TIP_KEYS[tipIndex % TIP_KEYS.length]);
    }
    function rotatePhrase() {
      phraseIndex = (phraseIndex + 1) % PHRASE_KEYS.length;
      if (phraseEl) {
        phraseEl.classList.remove("phrase-swap");
        void phraseEl.offsetWidth;
        phraseEl.classList.add("phrase-swap");
      }
      applyText();
    }
    function rotateTip() {
      tipIndex = (tipIndex + 1) % TIP_KEYS.length;
      if (tipEl) {
        tipEl.classList.remove("tip-swap");
        void tipEl.offsetWidth;
        tipEl.classList.add("tip-swap");
      }
      applyText();
    }
    function place() {
      if (!anchor || !stage) return;
      const point = toScreen(anchor.x, anchor.y);
      layer.style.left = `${point.x}px`;
      layer.style.top = `${point.y}px`;
      rafId = requestAnimationFrame(place);
    }
    function show(anchorWorld) {
      if (!layer || !anchorWorld) return false;
      hide(true);
      anchor = { x: anchorWorld.x, y: anchorWorld.y };
      const built = buildStage(effect);
      stage = built.stage;
      phraseEl = built.phrase;
      tipEl = built.tip;
      layer.appendChild(stage);
      applyText();
      layer.hidden = false;
      layer.setAttribute("aria-hidden", "false");
      phraseTimer = setInterval(rotatePhrase, PHRASE_MS);
      tipTimer = setInterval(rotateTip, TIP_MS);
      rafId = requestAnimationFrame(place);
      return true;
    }
    function hide(instant = false) {
      clearInterval(phraseTimer);
      clearInterval(tipTimer);
      clearTimeout(hideTimer);
      cancelAnimationFrame(rafId);
      phraseTimer = 0;
      tipTimer = 0;
      rafId = 0;
      if (!stage) {
        anchor = null;
        if (layer) {
          layer.hidden = true;
          layer.setAttribute("aria-hidden", "true");
        }
        return;
      }
      const old = stage;
      stage = null;
      phraseEl = null;
      tipEl = null;
      anchor = null;
      if (instant) {
        old.remove();
        layer.hidden = true;
        layer.setAttribute("aria-hidden", "true");
        return;
      }
      old.classList.add("summon-leaving");
      hideTimer = setTimeout(() => {
        old.remove();
        if (!stage) {
          layer.hidden = true;
          layer.setAttribute("aria-hidden", "true");
        }
      }, 420);
    }
    function setEffect(id) {
      if (EFFECTS.includes(id)) effect = id;
    }
    return {
      show,
      hide,
      setEffect,
      refreshText: applyText,
      get effect() {
        return effect;
      },
      get active() {
        return Boolean(stage);
      },
    };
  }

  return { EFFECTS, create };
});
