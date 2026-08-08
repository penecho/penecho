"use strict";
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PENECHO_SUMMON = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  const TAU = Math.PI * 2,
    LOADER_TYPES = ["lemniscate", "rose", "superellipse", "golden-spiral", "deltoid"],
    PHRASE_KEYS = Array.from({ length:12 }, (_, i) => `summonPhrase${i + 1}`),
    TIP_KEYS = Array.from({ length:24 }, (_, i) => `summonTip${i + 1}`),
    PHRASE_MS = 12000,
    TIP_MS = 26000,
    TEXT_INTERVALS = Object.freeze({ phrase:PHRASE_MS, tip:TIP_MS }),
    THINKING_LAYOUT = Object.freeze({
      loaderRadius:32,
      copyTop:52,
      copyWidth:330,
      copyHeight:82,
      padding:12,
      viewportMargin:14,
      overlapEpsilon:1e-6,
    });

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function mulberry32(seed) {
    let value = seed >>> 0 || 1;
    return () => {
      value |= 0;
      value = (value + 0x6d2b79f5) | 0;
      let next = Math.imul(value ^ (value >>> 15), 1 | value);
      next = (next + Math.imul(next ^ (next >>> 7), 61 | next)) ^ next;
      return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pickLoaderType(random = Math.random, previous = "") {
    const available = LOADER_TYPES.filter((type) => type !== previous),
      value = clamp01(Number(random()) || 0),
      index = Math.min(available.length - 1, Math.floor(value * available.length));
    return available[index];
  }

  function pickDifferentIndex(random, length, previous) {
    if (length <= 1) return 0;
    let index = Math.min(length - 1, Math.floor(clamp01(Number(random()) || 0) * length));
    if (index === previous) index = (index + 1) % length;
    return index;
  }

  function normalizePoints(points) {
    if (!points.length) return points;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const point of points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    const centerX = (minX + maxX) / 2,
      centerY = (minY + maxY) / 2,
      scale = 2 / Math.max(1e-6, maxX - minX, maxY - minY);
    return points.map((point) => ({
      x:(point.x - centerX) * scale,
      y:(point.y - centerY) * scale,
    }));
  }

  function buildLoaderData(type, seed) {
    const random = mulberry32(seed);
    return {
      hue:random() * 360,
      phase:random() * TAU,
      direction:random() < 0.5 ? -1 : 1,
    };
  }

  function signedPower(value, power) {
    return Math.sign(value) * Math.pow(Math.abs(value), power);
  }

  function buildLoaderPoints(type, data, elapsed = 0) {
    const points = [],
      samples = type === "golden-spiral" ? 220 : 240;
    for (let index = 0; index <= samples; index++) {
      const progress = index / samples,
        angle = progress * TAU;
      if (type === "lemniscate") {
        points.push({
          x:Math.sin(angle),
          y:Math.sin(angle) * Math.cos(angle) * 0.72,
        });
      } else if (type === "rose") {
        const radius = Math.cos(3 * angle);
        points.push({
          x:Math.cos(angle) * radius,
          y:Math.sin(angle) * radius,
        });
      } else if (type === "superellipse") {
        const exponent = 2 / (3.1 + Math.sin(elapsed * 0.48 + data.phase) * 0.38);
        points.push({
          x:signedPower(Math.cos(angle), exponent),
          y:signedPower(Math.sin(angle), exponent),
        });
      } else if (type === "golden-spiral") {
        const spiralAngle = progress * Math.PI * 5,
          radius = 0.105 * Math.exp(spiralAngle * 0.138);
        points.push({
          x:Math.cos(spiralAngle + data.phase) * radius,
          y:Math.sin(spiralAngle + data.phase) * radius,
        });
      } else {
        points.push({
          x:2 * Math.cos(angle) + Math.cos(2 * angle),
          y:2 * Math.sin(angle) - Math.sin(2 * angle),
        });
      }
    }
    return normalizePoints(points);
  }

  function pathIsClosed(type) {
    return type !== "golden-spiral";
  }

  function traceIndex(index, length, closed) {
    if (closed) return ((index % length) + length) % length;
    return index >= 0 && index < length ? index : -1;
  }

  function drawPolyline(ctx, points) {
    if (points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index++) ctx.lineTo(points[index].x, points[index].y);
    ctx.stroke();
  }

  function drawTrail(ctx, points, model, elapsed, fade, aiColor) {
    if (points.length < 2) return;
    const closed = pathIsClosed(model.type),
      length = points.length,
      trailLength = Math.floor(length * 0.22),
      cycle = ((elapsed * 0.105 * model.data.direction + model.data.phase / TAU) % 1 + 1) % 1,
      head = closed ? Math.floor(cycle * length) : Math.floor(cycle * (length + trailLength)),
      colorDrift = Math.sin(elapsed * 0.24) * 4;

    ctx.save();
    ctx.strokeStyle = aiColor;
    ctx.globalAlpha = fade * 0.14;
    ctx.lineWidth = 1.1;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    drawPolyline(ctx, points);
    ctx.restore();

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.05;
    for (let step = 1; step <= trailLength; step++) {
      const previous = traceIndex(head - trailLength + step - 1, length, closed),
        current = traceIndex(head - trailLength + step, length, closed);
      if (previous < 0 || current < 0) continue;
      const strength = step / trailLength,
        hue = (model.data.hue + colorDrift + strength * 34) % 360;
      ctx.strokeStyle = `hsla(${hue},76%,48%,${fade * (0.14 + strength * 0.78)})`;
      ctx.beginPath();
      ctx.moveTo(points[previous].x, points[previous].y);
      ctx.lineTo(points[current].x, points[current].y);
      ctx.stroke();
    }

    const headIndex = traceIndex(head, length, closed);
    if (headIndex < 0) return;
    const point = points[headIndex],
      hue = (model.data.hue + colorDrift + 34) % 360;
    ctx.fillStyle = `hsla(${hue},80%,45%,${fade * 0.96})`;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 1.9, 0, TAU);
    ctx.fill();
  }

  function thinkingFootprint(center, viewportWidth) {
    const width = Math.max(0, Number(viewportWidth) || 0),
      copyWidth = Math.max(0, Math.min(THINKING_LAYOUT.copyWidth, width - 36)),
      copyHeight = THINKING_LAYOUT.copyHeight + Math.max(0, THINKING_LAYOUT.copyWidth - copyWidth) * 0.48,
      halfWidth = Math.max(THINKING_LAYOUT.loaderRadius, copyWidth / 2),
      left = center.x - halfWidth - THINKING_LAYOUT.padding,
      top = center.y - THINKING_LAYOUT.loaderRadius - THINKING_LAYOUT.padding,
      right = center.x + halfWidth + THINKING_LAYOUT.padding,
      bottom = center.y + THINKING_LAYOUT.copyTop + copyHeight + THINKING_LAYOUT.padding;
    return { x:left, y:top, w:right - left, h:bottom - top };
  }

  function chooseThinkingPlacement(options = {}) {
    const width = Math.max(1, Number(options.width) || 1),
      height = Math.max(1, Number(options.height) || 1),
      template = thinkingFootprint({ x:0, y:0 }, width),
      margin = Math.min(THINKING_LAYOUT.viewportMargin, width / 2, height / 2),
      minX = margin - template.x,
      maxX = width - margin - template.x - template.w,
      minY = margin - template.y,
      maxY = height - margin - template.y - template.h,
      clampAxis = (value, min, max, fallback) => min <= max ? Math.max(min, Math.min(max, value)) : fallback,
      clampCenter = (x, y) => ({
        x:clampAxis(x, minX, maxX, width / 2),
        y:clampAxis(y, minY, maxY, height / 2),
      }),
      blockers = (Array.isArray(options.blockers) ? options.blockers : [])
        .filter((rect) => rect && Number.isFinite(rect.x) && Number.isFinite(rect.y)
          && Number.isFinite(rect.w) && Number.isFinite(rect.h) && rect.w > 0 && rect.h > 0),
      anchor = options.anchor && Number.isFinite(options.anchor.x) && Number.isFinite(options.anchor.y)
        && Number.isFinite(options.anchor.w) && Number.isFinite(options.anchor.h)
        ? options.anchor
        : null,
      candidates = [],
      seen = new Set(),
      addCandidate = (x, y) => {
        const point = clampCenter(x, y),
          key = `${Math.round(point.x * 10)},${Math.round(point.y * 10)}`;
        if (seen.has(key)) return;
        seen.add(key);
        candidates.push(point);
      },
      overlapScore = (box) => {
        let score = 0;
        for (const blocker of blockers) {
          const overlapWidth = Math.min(box.x + box.w, blocker.x + blocker.w) - Math.max(box.x, blocker.x),
            overlapHeight = Math.min(box.y + box.h, blocker.y + blocker.h) - Math.max(box.y, blocker.y);
          if (overlapWidth > THINKING_LAYOUT.overlapEpsilon && overlapHeight > THINKING_LAYOUT.overlapEpsilon)
            score += overlapWidth * overlapHeight * Math.max(1, Number(blocker.weight) || 1);
        }
        return score;
      },
      emptyPlacement = () => {
        const minLeft = margin,
          maxLeft = width - margin - template.w,
          minTop = margin,
          maxTop = height - margin - template.h;
        if (maxLeft < minLeft || maxTop < minTop) return null;
        const preferred = anchor
            ? { x:anchor.x + anchor.w / 2, y:anchor.y + anchor.h / 2 }
            : { x:width / 2, y:height / 2 },
          preferredLeft = preferred.x - template.w / 2,
          boxCenterOffsetY = template.y + template.h / 2,
          tops = [minTop];
        for (const blocker of blockers) {
          const top = blocker.y + blocker.h;
          if (top >= minTop && top <= maxTop) tops.push(top);
        }
        tops.sort((a, b) => Math.abs(a + boxCenterOffsetY - preferred.y) - Math.abs(b + boxCenterOffsetY - preferred.y));
        let bestEmpty = null,
          bestDistance = Infinity;
        for (const top of tops) {
          const intervals = [];
          for (const blocker of blockers) {
            if (blocker.y >= top + template.h || blocker.y + blocker.h <= top) continue;
            const start = blocker.x - template.w,
              end = blocker.x + blocker.w;
            if (end < minLeft || start > maxLeft) continue;
            intervals.push({ start:Math.max(minLeft, start), end:Math.min(maxLeft, end) });
          }
          intervals.sort((a, b) => a.start - b.start || a.end - b.end);
          const merged = [];
          for (const interval of intervals) {
            const previous = merged[merged.length - 1];
            if (previous && interval.start < previous.end - THINKING_LAYOUT.overlapEpsilon) previous.end = Math.max(previous.end, interval.end);
            else merged.push({ ...interval });
          }
          const gaps = [];
          let cursor = minLeft;
          for (const interval of merged) {
            if (interval.start + THINKING_LAYOUT.overlapEpsilon >= cursor)
              gaps.push({ start:cursor, end:Math.max(cursor, interval.start) });
            cursor = Math.max(cursor, interval.end);
          }
          if (cursor <= maxLeft) gaps.push({ start:cursor, end:maxLeft });
          for (const gap of gaps) {
            const left = Math.max(gap.start, Math.min(gap.end, preferredLeft)),
              point = { x:left - template.x, y:top - template.y },
              box = thinkingFootprint(point, width);
            if (overlapScore(box) !== 0) continue;
            const dx = point.x - preferred.x,
              dy = point.y - preferred.y,
              distance = dx * dx + dy * dy;
            if (distance < bestDistance) {
              bestDistance = distance;
              bestEmpty = { x:point.x, y:point.y, box, score:0 };
            }
          }
        }
        return bestEmpty;
      };
    if (anchor) {
      const centerX = anchor.x + anchor.w / 2,
        centerY = anchor.y + anchor.h / 2,
        gap = 18;
      addCandidate(anchor.x + anchor.w + gap - template.x, centerY);
      addCandidate(centerX, anchor.y + anchor.h + gap - template.y);
      addCandidate(anchor.x - gap - template.x - template.w, centerY);
      addCandidate(centerX, anchor.y - gap - template.y - template.h);
    }
    addCandidate(width / 2, height / 2);
    for (const y of [0.17, 0.38, 0.62, 0.83])
      for (const x of [0.12, 0.31, 0.5, 0.69, 0.88]) addCandidate(width * x, height * y);
    let best = candidates[0] || clampCenter(width / 2, height / 2),
      bestBox = thinkingFootprint(best, width),
      bestScore = overlapScore(bestBox);
    for (let index = 1; index < candidates.length; index++) {
      const candidate = candidates[index],
        box = thinkingFootprint(candidate, width),
        score = overlapScore(box);
      if (score < bestScore) {
        best = candidate;
        bestBox = box;
        bestScore = score;
        if (score === 0) break;
      }
    }
    if (bestScore > 0) {
      const empty = emptyPlacement();
      if (empty) return empty;
    }
    return { x:best.x, y:best.y, box:bestBox, score:bestScore };
  }

  function create(options) {
    const canvas = options.fxCanvas,
      ctx = canvas?.getContext("2d"),
      textLayer = options.textLayer,
      t = options.t,
      getTransform = options.getTransform,
      getAiColor = options.getAiColor || (() => "#2563eb"),
      styleFor = options.styleFor || (() => null);
    let model = null,
      rafId = 0,
      startTime = 0,
      hideAt = 0,
      phraseTimer = 0,
      tipTimer = 0,
      phraseIndex = 0,
      tipIndex = 0,
      copyEl = null,
      copyStyle = null,
      captionEl = null,
      hintEl = null,
      lastType = "",
      lastPhraseIndex = -1,
      lastTipIndex = -1;

    function now() {
      return performance.now() / 1000;
    }

    function applyText() {
      if (captionEl) captionEl.textContent = t(PHRASE_KEYS[phraseIndex % PHRASE_KEYS.length]);
      if (hintEl) hintEl.textContent = t(TIP_KEYS[tipIndex % TIP_KEYS.length]);
    }

    function swapText(element, className) {
      if (!element) return;
      element.classList.remove(className);
      void element.offsetWidth;
      element.classList.add(className);
    }

    function rotatePhrase() {
      phraseIndex = (phraseIndex + 1) % PHRASE_KEYS.length;
      swapText(captionEl, "caption-swap");
      applyText();
    }

    function rotateTip() {
      tipIndex = (tipIndex + 1) % TIP_KEYS.length;
      swapText(hintEl, "hint-swap");
      applyText();
    }

    function buildText() {
      if (!textLayer) return;
      textLayer.textContent = "";
      copyEl = document.createElement("div");
      copyEl.className = "summon-copy";
      copyStyle = styleFor(copyEl);
      captionEl = document.createElement("div");
      captionEl.className = "summon-caption caption-swap";
      hintEl = document.createElement("div");
      hintEl.className = "summon-hint hint-swap";
      copyEl.append(captionEl, hintEl);
      textLayer.appendChild(copyEl);
      applyText();
    }

    function placeText(screenX, screenY) {
      if (!copyStyle) return;
      copyStyle.left = `${screenX}px`;
      copyStyle.top = `${screenY + THINKING_LAYOUT.copyTop}px`;
    }

    function drawLoader(elapsed, fade, screenX, screenY) {
      const radius = (THINKING_LAYOUT.loaderRadius - 2) * (1 + Math.sin(elapsed * 0.68 + model.data.phase) * 0.018),
        points = buildLoaderPoints(model.type, model.data, elapsed)
          .map((point) => ({ x:point.x * radius, y:point.y * radius }));
      ctx.save();
      ctx.translate(screenX, screenY);
      drawTrail(ctx, points, model, elapsed, fade, getAiColor());
      ctx.restore();
    }

    function stop() {
      cancelAnimationFrame(rafId);
      rafId = 0;
      clearInterval(phraseTimer);
      clearInterval(tipTimer);
      phraseTimer = 0;
      tipTimer = 0;
      model = null;
      hideAt = 0;
      copyEl = null;
      copyStyle = null;
      captionEl = null;
      hintEl = null;
      if (textLayer) textLayer.textContent = "";
      if (ctx && canvas) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        delete canvas.dataset.loaderType;
        canvas.hidden = true;
      }
    }

    function frame() {
      if (!model) return;
      rafId = requestAnimationFrame(frame);
      const transform = getTransform(),
        dpr = transform.dpr || 1,
        elapsed = now() - startTime,
        screenX = model.anchor.x * transform.scale + transform.panX,
        screenY = model.anchor.y * transform.scale + transform.panY;
      let fade = 1;
      if (hideAt) {
        fade = clamp01(1 - (now() - hideAt) / 0.36);
        if (fade <= 0) {
          stop();
          return;
        }
      }
      if (canvas.width !== Math.round(transform.width * dpr) || canvas.height !== Math.round(transform.height * dpr)) {
        canvas.width = Math.round(transform.width * dpr);
        canvas.height = Math.round(transform.height * dpr);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawLoader(elapsed, fade, screenX, screenY);
      if (copyStyle) copyStyle.opacity = String(fade);
      placeText(screenX, screenY);
    }

    function show(anchor) {
      if (!ctx || !canvas || !textLayer || !anchor) return false;
      stop();
      const seed = ((Date.now() & 0xffffffff) ^ ((anchor.x * 2654435761) | 0) ^ ((anchor.y * 1597334677) | 0)) >>> 0,
        random = mulberry32(seed),
        type = pickLoaderType(random, lastType);
      lastType = type;
      model = {
        anchor:{ x:anchor.x, y:anchor.y },
        type,
        data:buildLoaderData(type, seed),
      };
      phraseIndex = pickDifferentIndex(random, PHRASE_KEYS.length, lastPhraseIndex);
      tipIndex = pickDifferentIndex(random, TIP_KEYS.length, lastTipIndex);
      lastPhraseIndex = phraseIndex;
      lastTipIndex = tipIndex;
      buildText();
      canvas.dataset.loaderType = type;
      canvas.hidden = false;
      startTime = now();
      hideAt = 0;
      phraseTimer = setInterval(rotatePhrase, PHRASE_MS);
      tipTimer = setInterval(rotateTip, TIP_MS);
      rafId = requestAnimationFrame(frame);
      return true;
    }

    function hide() {
      if (model && !hideAt) hideAt = now();
      else if (!model) stop();
    }

    return {
      show,
      hide,
      refreshText: applyText,
      get type() {
        return model?.type || lastType;
      },
      get active() {
        return Boolean(model);
      },
    };
  }

  return {
    LOADER_TYPES,
    TEXT_INTERVALS,
    THINKING_LAYOUT,
    pickLoaderType,
    pickDifferentIndex,
    buildLoaderData,
    buildLoaderPoints,
    thinkingFootprint,
    chooseThinkingPlacement,
    create,
  };
});
