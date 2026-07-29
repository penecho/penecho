"use strict";
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PENECHO_SUMMON = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  const TAU = Math.PI * 2,
    LOADER_TYPES = ["lemniscate", "rose", "superellipse", "golden-spiral", "deltoid"],
    HOTSPOT_TRAIL_BLUE = "#2878ff",
    HOTSPOT_LEAD_BLUE = "#9bc7ff",
    HOTSPOT_FLASH_COUNT = 3,
    HOTSPOT_FLASH_SECONDS = 1.65,
    PHRASE_KEYS = Array.from({ length:12 }, (_, i) => `summonPhrase${i + 1}`),
    TIP_KEYS = Array.from({ length:10 }, (_, i) => `summonTip${i + 1}`),
    PHRASE_MS = 12000,
    TIP_MS = 26000,
    TEXT_INTERVALS = Object.freeze({ phrase:PHRASE_MS, tip:TIP_MS });

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function hotspotFlashPulse(elapsed) {
    const progress = clamp01(elapsed / HOTSPOT_FLASH_SECONDS);
    return progress >= 1 ? 0 : Math.pow(Math.sin(progress * Math.PI * HOTSPOT_FLASH_COUNT), 2);
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
    const cx = (minX + maxX) / 2,
      cy = (minY + maxY) / 2,
      scale = 2 / Math.max(1e-6, maxX - minX, maxY - minY);
    return points.map((point) => ({ ...point, x:(point.x - cx) * scale, y:(point.y - cy) * scale }));
  }

  function buildLoaderData(type, seed) {
    const random = mulberry32(seed);
    return {
      hue: random() * 360,
      phase: random() * TAU,
      direction: random() < 0.5 ? -1 : 1,
    };
  }

  function signedPower(value, power) {
    return Math.sign(value) * Math.pow(Math.abs(value), power);
  }

  function buildLoaderPoints(type, data, elapsed = 0) {
    const points = [],
      samples = type === "golden-spiral" ? 220 : 240;
    for (let i = 0; i <= samples; i++) {
      const progress = i / samples,
        t = progress * TAU;
      if (type === "lemniscate") {
        points.push({
          x: Math.sin(t),
          y: Math.sin(t) * Math.cos(t) * 0.72,
        });
      } else if (type === "rose") {
        const radius = Math.cos(3 * t);
        points.push({
          x: Math.cos(t) * radius,
          y: Math.sin(t) * radius,
        });
      } else if (type === "superellipse") {
        const exponent = 2 / (3.1 + Math.sin(elapsed * 0.48 + data.phase) * 0.38);
        points.push({
          x: signedPower(Math.cos(t), exponent),
          y: signedPower(Math.sin(t), exponent),
        });
      } else if (type === "golden-spiral") {
        const angle = progress * Math.PI * 5,
          radius = 0.105 * Math.exp(angle * 0.138);
        points.push({
          x: Math.cos(angle + data.phase) * radius,
          y: Math.sin(angle + data.phase) * radius,
        });
      } else {
        points.push({
          x: 2 * Math.cos(t) + Math.cos(2 * t),
          y: 2 * Math.sin(t) - Math.sin(2 * t),
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
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
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
    if (headIndex >= 0) {
      const point = points[headIndex],
        hue = (model.data.hue + colorDrift + 34) % 360;
      ctx.fillStyle = `hsla(${hue},80%,45%,${fade * 0.96})`;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 1.9, 0, TAU);
      ctx.fill();
    }
  }

  function intersectRects(a, b) {
    const x = Math.max(a.x, b.x),
      y = Math.max(a.y, b.y),
      right = Math.min(a.x + a.w, b.x + b.w),
      bottom = Math.min(a.y + a.h, b.y + b.h);
    return right > x && bottom > y ? { x, y, w:right - x, h:bottom - y } : null;
  }

  function unionRects(a, b) {
    const x = Math.min(a.x, b.x),
      y = Math.min(a.y, b.y);
    return {
      x,
      y,
      w:Math.max(a.x + a.w, b.x + b.w) - x,
      h:Math.max(a.y + a.h, b.y + b.h) - y,
    };
  }

  function rectsAreNear(a, b, gap) {
    return a.x <= b.x + b.w + gap
      && a.x + a.w + gap >= b.x
      && a.y <= b.y + b.h + gap
      && a.y + a.h + gap >= b.y;
  }

  function pointRectDistance(point, rect) {
    const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.w)),
      dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.h));
    return Math.hypot(dx, dy);
  }

  function validPoint(point) {
    return point && Number.isFinite(point.x) && Number.isFinite(point.y);
  }

  function buildContentBlocks(rects, transform, hotspot = null) {
    const scale = Math.max(0.03, Number(transform?.scale) || 1),
      visible = {
        x:-(Number(transform?.panX) || 0) / scale,
        y:-(Number(transform?.panY) || 0) / scale,
        w:Math.max(0, Number(transform?.width) || 0) / scale,
        h:Math.max(0, Number(transform?.height) || 0) / scale,
      },
      gap = 18 / scale,
      padding = 12 / scale,
      groups = [];
    if (!hotspot) return [];
    for (const source of Array.isArray(rects) ? rects : []) {
      if (!source || !Number.isFinite(source.x) || !Number.isFinite(source.y)
        || !Number.isFinite(source.w) || !Number.isFinite(source.h) || source.w <= 0 || source.h <= 0) continue;
      let merged = intersectRects(source, visible);
      if (!merged) continue;
      for (let index = groups.length - 1; index >= 0; index--) {
        if (!rectsAreNear(merged, groups[index], gap)) continue;
        merged = unionRects(merged, groups[index]);
        groups.splice(index, 1);
        index = groups.length;
      }
      groups.push(merged);
    }
    const hotspotBox = hotspot.box && Number.isFinite(hotspot.box.x) && Number.isFinite(hotspot.box.y)
        && Number.isFinite(hotspot.box.w) && Number.isFinite(hotspot.box.h) && hotspot.box.w > 0 && hotspot.box.h > 0
        ? intersectRects(hotspot.box, visible)
        : null,
      recentPoints = Array.isArray(hotspot.points) ? hotspot.points.filter(validPoint) : [],
      focuses = recentPoints.length
        ? recentPoints
        : validPoint(hotspot.point)
          ? [hotspot.point]
          : hotspotBox
            ? [{ x:hotspotBox.x + hotspotBox.w / 2, y:hotspotBox.y + hotspotBox.h / 2 }]
            : [];
    if (!focuses.length) return [];
    const neighborhood = 180 / scale,
      local = [];
    for (const focus of focuses) {
      const orbitWindow = intersectRects({
        x:focus.x - 120 / scale,
        y:focus.y - 90 / scale,
        w:240 / scale,
        h:180 / scale,
      }, visible);
      if (!orbitWindow) continue;
      const closest = groups
        .map((block) => ({ block:intersectRects(block, orbitWindow), distance:pointRectDistance(focus, block) }))
        .filter((entry) => entry.block && entry.distance <= neighborhood)
        .sort((a, b) => a.distance - b.distance)[0];
      if (closest) local.push(closest.block);
    }
    if (!local.length && recentPoints.length) {
      for (const focus of focuses) {
        const fallback = intersectRects({
          x:focus.x - 24 / scale,
          y:focus.y - 18 / scale,
          w:48 / scale,
          h:36 / scale,
        }, visible);
        if (fallback) local.push(fallback);
      }
    } else if (!local.length && hotspotBox) {
      local.push(hotspotBox);
    }
    const merged = [];
    for (const block of local) {
      const index = merged.findIndex((current) => rectsAreNear(current, block, gap));
      if (index < 0) merged.push(block);
      else merged[index] = unionRects(merged[index], block);
    }
    return merged
      .map((block) => intersectRects({
        x:block.x - padding,
        y:block.y - padding,
        w:block.w + padding * 2,
        h:block.h + padding * 2,
      }, visible))
      .filter(Boolean);
  }

  function hotspotOrbitPoints(box, phase) {
    const points = [],
      step = 4,
      radius = Math.max(3, Math.min(14 + Math.sin(phase) * 1.2, box.w / 4, box.h / 4)),
      left = box.x,
      top = box.y,
      right = box.x + box.w,
      bottom = box.y + box.h,
      addLine = (x1, y1, x2, y2) => {
        const count = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / step));
        for (let index = 0; index < count; index++) {
          const progress = index / count;
          points.push({ x:x1 + (x2 - x1) * progress, y:y1 + (y2 - y1) * progress });
        }
      },
      addArc = (centerX, centerY, start, end) => {
        const count = Math.max(2, Math.ceil(radius * Math.abs(end - start) / step));
        for (let index = 0; index < count; index++) {
          const angle = start + (end - start) * index / count;
          points.push({ x:centerX + Math.cos(angle) * radius, y:centerY + Math.sin(angle) * radius });
        }
      };
    addLine(left + radius, top, right - radius, top);
    addArc(right - radius, top + radius, -Math.PI / 2, 0);
    addLine(right, top + radius, right, bottom - radius);
    addArc(right - radius, bottom - radius, 0, Math.PI / 2);
    addLine(right - radius, bottom, left + radius, bottom);
    addArc(left + radius, bottom - radius, Math.PI / 2, Math.PI);
    addLine(left, bottom - radius, left, top + radius);
    addArc(left + radius, top + radius, Math.PI, Math.PI * 1.5);
    if (points.length < 8) {
      return [
        { x:left, y:top },
        { x:right, y:top },
        { x:right, y:bottom },
        { x:left, y:bottom },
      ];
    }
    return points;
  }

  function screenBox(block, transform) {
    const inset = 6,
      left = Math.max(inset, Math.min(transform.width - inset, block.x * transform.scale + transform.panX)),
      top = Math.max(inset, Math.min(transform.height - inset, block.y * transform.scale + transform.panY)),
      right = Math.max(inset, Math.min(transform.width - inset, (block.x + block.w) * transform.scale + transform.panX)),
      bottom = Math.max(inset, Math.min(transform.height - inset, (block.y + block.h) * transform.scale + transform.panY));
    return right - left >= 12 && bottom - top >= 12 ? { x:left, y:top, w:right - left, h:bottom - top } : null;
  }

  function buildEdgePlan(blocks, transform, random) {
    const count = Math.max(1, blocks.length);
    return blocks.map((block) => {
      const perimeter = 2 * (block.w + block.h) * transform.scale,
        pause = 0.12 + random() * 0.12;
      return {
        block,
        direction:random() < 0.5 ? -1 : 1,
        offset:random(),
        phase:random() * TAU,
        duration:Math.max(0.9, Math.min(3.1, 5.6 / count - pause + perimeter / 1800)),
        pause,
      };
    });
  }

  function orderedEdgePoints(points, plan) {
    if (!points.length) return points;
    let ordered = plan.direction < 0 ? points.slice().reverse() : points.slice(),
      offset = Math.floor(plan.offset * ordered.length);
    ordered = ordered.slice(offset).concat(ordered.slice(0, offset));
    ordered.push(ordered[0]);
    return ordered;
  }

  function strokeEdgePath(ctx, points, count, style, width, alpha) {
    if (count < 2) return;
    ctx.save();
    ctx.strokeStyle = style;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < count; index++) ctx.lineTo(points[index].x, points[index].y);
    ctx.stroke();
    ctx.restore();
  }

  function strokeClosedEdge(ctx, plan, transform, style, width, alpha) {
    const box = screenBox(plan.block, transform);
    if (!box) return;
    const points = orderedEdgePoints(hotspotOrbitPoints(box, plan.phase), plan);
    strokeEdgePath(ctx, points, points.length, style, width, alpha);
  }

  function screenObstacleRects(rects, transform, clearance = 9) {
    const scale = Math.max(0.03, Number(transform?.scale) || 1),
      width = Math.max(0, Number(transform?.width) || 0),
      height = Math.max(0, Number(transform?.height) || 0),
      panX = Number(transform?.panX) || 0,
      panY = Number(transform?.panY) || 0,
      viewport = { x:0, y:0, w:width, h:height },
      obstacles = [];
    for (const rect of Array.isArray(rects) ? rects : []) {
      if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y)
        || !Number.isFinite(rect.w) || !Number.isFinite(rect.h) || rect.w <= 0 || rect.h <= 0) continue;
      const screen = intersectRects({
        x:rect.x * scale + panX - clearance,
        y:rect.y * scale + panY - clearance,
        w:rect.w * scale + clearance * 2,
        h:rect.h * scale + clearance * 2,
      }, viewport);
      if (screen && screen.w >= 2 && screen.h >= 2) obstacles.push(screen);
    }
    return obstacles;
  }

  function pointInsideRect(point, rect) {
    return point.x > rect.x && point.x < rect.x + rect.w
      && point.y > rect.y && point.y < rect.y + rect.h;
  }

  function screenHotspot(hotspot, transform) {
    const points = Array.isArray(hotspot?.points) ? hotspot.points.filter(validPoint) : [],
      point = points.at(-1) || (validPoint(hotspot?.point) ? hotspot.point : null)
        || (hotspot?.box ? { x:hotspot.box.x + hotspot.box.w / 2, y:hotspot.box.y + hotspot.box.h / 2 } : null);
    if (!validPoint(point)) return null;
    return {
      x:point.x * transform.scale + transform.panX,
      y:point.y * transform.scale + transform.panY,
    };
  }

  function buildFlightModel(rects, hotspot, transform, random = Math.random) {
    const width = Math.max(40, Number(transform?.width) || 0),
      height = Math.max(40, Number(transform?.height) || 0),
      radius = 3.2,
      clearance = 9 + radius,
      obstacles = screenObstacleRects(rects, transform, clearance),
      focus = screenHotspot(hotspot, transform) || { x:width / 2, y:height / 2 },
      clampPoint = (point) => ({
        x:Math.max(radius + 3, Math.min(width - radius - 3, point.x)),
        y:Math.max(radius + 3, Math.min(height - radius - 3, point.y)),
      }),
      blocked = (point) => obstacles.some((rect) => pointInsideRect(point, rect));
    let launch = clampPoint(focus),
      normal = { x:0, y:0 },
      source = obstacles.find((rect) => pointInsideRect(launch, rect));
    if (source) {
      const candidates = [
        { x:Math.max(source.x, Math.min(source.x + source.w, launch.x)), y:source.y - 1, nx:0, ny:-1 },
        { x:source.x + source.w + 1, y:Math.max(source.y, Math.min(source.y + source.h, launch.y)), nx:1, ny:0 },
        { x:Math.max(source.x, Math.min(source.x + source.w, launch.x)), y:source.y + source.h + 1, nx:0, ny:1 },
        { x:source.x - 1, y:Math.max(source.y, Math.min(source.y + source.h, launch.y)), nx:-1, ny:0 },
      ].map((candidate) => ({ ...clampPoint(candidate), nx:candidate.nx, ny:candidate.ny }))
        .filter((point) => !blocked(point));
      if (candidates.length) {
        const index = Math.min(candidates.length - 1, Math.floor(clamp01(Number(random()) || 0) * candidates.length)),
          selected = candidates[index];
        launch = { x:selected.x, y:selected.y };
        normal = { x:selected.nx || 0, y:selected.ny || 0 };
      }
    }
    if (blocked(launch)) {
      for (let ring = 1; ring <= 8 && blocked(launch); ring++) {
        for (let index = 0; index < 16; index++) {
          const angle = index / 16 * TAU,
            candidate = clampPoint({ x:focus.x + Math.cos(angle) * ring * 18, y:focus.y + Math.sin(angle) * ring * 18 });
          if (blocked(candidate)) continue;
          launch = candidate;
          normal = { x:Math.cos(angle), y:Math.sin(angle) };
          break;
        }
      }
    }
    const baseAngle = normal.x || normal.y
        ? Math.atan2(normal.y, normal.x) + (random() - 0.5) * 0.7
        : random() * TAU,
      speed = 112 + random() * 38;
    return {
      x:launch.x,
      y:launch.y,
      vx:Math.cos(baseAngle) * speed,
      vy:Math.sin(baseAngle) * speed,
      radius,
      clearance,
      trail:[{ x:launch.x, y:launch.y }],
      impacts:[],
      lastElapsed:0,
    };
  }

  function advanceFlight(flight, delta, bounds, obstacles) {
    if (!flight) return flight;
    const width = Math.max(1, Number(bounds?.width) || 1),
      height = Math.max(1, Number(bounds?.height) || 1),
      dt = Math.max(0, Math.min(0.05, Number(delta) || 0)),
      speed = Math.hypot(flight.vx, flight.vy),
      steps = Math.max(1, Math.ceil(speed * dt / 3)),
      stepTime = dt / steps,
      inset = flight.radius + 3,
      recordImpact = (x, y) => {
        flight.impacts.push({ x, y, age:0 });
        if (flight.impacts.length > 6) flight.impacts.splice(0, flight.impacts.length - 6);
      };
    for (const impact of flight.impacts) impact.age += dt;
    flight.impacts = flight.impacts.filter((impact) => impact.age < 0.42);
    for (let step = 0; step < steps; step++) {
      const previous = { x:flight.x, y:flight.y };
      let nextX = flight.x + flight.vx * stepTime,
        nextY = flight.y + flight.vy * stepTime,
        collided = false;
      if (nextX < inset || nextX > width - inset) {
        nextX = Math.max(inset, Math.min(width - inset, nextX));
        flight.vx = nextX <= inset ? Math.abs(flight.vx) : -Math.abs(flight.vx);
        collided = true;
      }
      if (nextY < inset || nextY > height - inset) {
        nextY = Math.max(inset, Math.min(height - inset, nextY));
        flight.vy = nextY <= inset ? Math.abs(flight.vy) : -Math.abs(flight.vy);
        collided = true;
      }
      for (const rect of Array.isArray(obstacles) ? obstacles : []) {
        if (!pointInsideRect({ x:nextX, y:nextY }, rect)) continue;
        const left = rect.x,
          right = rect.x + rect.w,
          top = rect.y,
          bottom = rect.y + rect.h;
        if (previous.x <= left) {
          nextX = left;
          flight.vx = -Math.abs(flight.vx);
        } else if (previous.x >= right) {
          nextX = right;
          flight.vx = Math.abs(flight.vx);
        } else if (previous.y <= top) {
          nextY = top;
          flight.vy = -Math.abs(flight.vy);
        } else if (previous.y >= bottom) {
          nextY = bottom;
          flight.vy = Math.abs(flight.vy);
        } else {
          const sides = [
            { distance:Math.abs(nextX - left), axis:"x", value:left, velocity:-Math.abs(flight.vx) },
            { distance:Math.abs(right - nextX), axis:"x", value:right, velocity:Math.abs(flight.vx) },
            { distance:Math.abs(nextY - top), axis:"y", value:top, velocity:-Math.abs(flight.vy) },
            { distance:Math.abs(bottom - nextY), axis:"y", value:bottom, velocity:Math.abs(flight.vy) },
          ].sort((a, b) => a.distance - b.distance)[0];
          if (sides.axis === "x") {
            nextX = sides.value;
            flight.vx = sides.velocity;
          } else {
            nextY = sides.value;
            flight.vy = sides.velocity;
          }
        }
        collided = true;
        break;
      }
      flight.x = nextX;
      flight.y = nextY;
      if (collided) recordImpact(nextX, nextY);
      const last = flight.trail.at(-1);
      if (!last || collided || Math.hypot(nextX - last.x, nextY - last.y) >= 3.4)
        flight.trail.push({ x:nextX, y:nextY });
      if (flight.trail.length > 34) flight.trail.splice(0, flight.trail.length - 34);
    }
    return flight;
  }

  function drawFlight(ctx, flight, fade) {
    if (!flight?.trail.length) return;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let index = 1; index < flight.trail.length; index++) {
      const previous = flight.trail[index - 1],
        current = flight.trail[index],
        strength = index / Math.max(1, flight.trail.length - 1);
      ctx.strokeStyle = HOTSPOT_TRAIL_BLUE;
      ctx.globalAlpha = fade * strength * 0.08;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(previous.x, previous.y);
      ctx.lineTo(current.x, current.y);
      ctx.stroke();
      ctx.globalAlpha = fade * strength * 0.58;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    for (const impact of flight.impacts) {
      const progress = impact.age / 0.42;
      ctx.strokeStyle = HOTSPOT_LEAD_BLUE;
      ctx.globalAlpha = fade * (1 - progress) * 0.52;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(impact.x, impact.y, 4 + progress * 14, 0, TAU);
      ctx.stroke();
    }
    ctx.fillStyle = HOTSPOT_TRAIL_BLUE;
    ctx.globalAlpha = fade * 0.2;
    ctx.beginPath();
    ctx.arc(flight.x, flight.y, 5.4, 0, TAU);
    ctx.fill();
    ctx.fillStyle = HOTSPOT_LEAD_BLUE;
    ctx.globalAlpha = fade * 0.98;
    ctx.beginPath();
    ctx.arc(flight.x, flight.y, flight.radius, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function create(options) {
    const canvas = options.fxCanvas,
      ctx = canvas?.getContext("2d"),
      textLayer = options.textLayer,
      t = options.t,
      getTransform = options.getTransform,
      getContentRects = options.getContentRects || (() => []),
      getHotspot = options.getHotspot || (() => null),
      getAiColor = options.getAiColor || (() => "#2563eb");
    let model = null,
      rafId = 0,
      startTime = 0,
      hideAt = 0,
      phraseTimer = 0,
      tipTimer = 0,
      phraseIndex = 0,
      tipIndex = 0,
      copyEl = null,
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
      captionEl = document.createElement("div");
      captionEl.className = "summon-caption";
      hintEl = document.createElement("div");
      hintEl.className = "summon-hint";
      copyEl.append(captionEl, hintEl);
      textLayer.appendChild(copyEl);
      applyText();
    }

    function placeText(screenX, screenY) {
      if (!copyEl) return;
      copyEl.style.left = `${screenX}px`;
      copyEl.style.top = `${screenY + 68}px`;
      copyEl.style.setProperty("--summon-ai-color", getAiColor());
    }

    function drawLoader(elapsed, fade, screenX, screenY) {
      const breath = 41 * (1 + Math.sin(elapsed * 0.68 + model.data.phase) * 0.018),
        points = buildLoaderPoints(model.type, model.data, elapsed)
          .map(point => ({ x:point.x * breath, y:point.y * breath }));
      ctx.save();
      ctx.translate(screenX, screenY);
      drawTrail(ctx, points, model, elapsed, fade, getAiColor());
      ctx.restore();
    }

    function drawViewportFlight(elapsed, fade, transform) {
      const flight = model.flight;
      if (!flight) return;
      const delta = Math.max(0, elapsed - flight.lastElapsed),
        obstacles = screenObstacleRects(getContentRects(), transform, flight.clearance);
      flight.lastElapsed = elapsed;
      advanceFlight(flight, delta, transform, obstacles);
      drawFlight(ctx, flight, fade);
    }

    function drawContentEdges(elapsed, fade, transform) {
      const edge = model.edge;
      if (!edge?.plans.length) return;
      let plan = edge.plans[edge.index];
      while (true) {
        if (edge.flashing) {
          if (elapsed - edge.started < HOTSPOT_FLASH_SECONDS) break;
          edge.started += HOTSPOT_FLASH_SECONDS;
          edge.flashing = false;
          edge.index = 0;
          plan = edge.plans[0];
          plan.offset = (plan.offset + 0.18 + edge.random() * 0.64) % 1;
          if (edge.random() < 0.42) plan.direction *= -1;
          continue;
        }
        if (elapsed - edge.started < plan.duration + plan.pause) break;
        edge.started += plan.duration + plan.pause;
        if (edge.index === edge.plans.length - 1) {
          edge.flashing = true;
          break;
        }
        edge.index += 1;
        plan = edge.plans[edge.index];
        plan.offset = (plan.offset + 0.18 + edge.random() * 0.64) % 1;
        if (edge.random() < 0.42) plan.direction *= -1;
      }
      if (edge.flashing) {
        const pulse = hotspotFlashPulse(elapsed - edge.started);
        for (const completedPlan of edge.plans) {
          strokeClosedEdge(ctx, completedPlan, transform, HOTSPOT_TRAIL_BLUE, 5.2, fade * (0.055 + pulse * 0.14));
          strokeClosedEdge(ctx, completedPlan, transform, HOTSPOT_LEAD_BLUE, 1.8, fade * (0.24 + pulse * 0.72));
        }
        return;
      }
      for (let index = 0; index < edge.index; index++) {
        strokeClosedEdge(ctx, edge.plans[index], transform, HOTSPOT_TRAIL_BLUE, 4.8, fade * 0.045);
        strokeClosedEdge(ctx, edge.plans[index], transform, HOTSPOT_TRAIL_BLUE, 1.05, fade * 0.2);
      }
      const age = elapsed - edge.started,
        drawing = Math.min(age, plan.duration),
        progress = clamp01(drawing / plan.duration),
        eased = progress * progress * (3 - 2 * progress),
        settle = age <= plan.duration ? 1 : clamp01(1 - (age - plan.duration) / plan.pause),
        box = screenBox(plan.block, transform);
      if (!box || settle <= 0) return;
      const points = orderedEdgePoints(hotspotOrbitPoints(box, plan.phase), plan),
        count = Math.max(2, Math.min(points.length, Math.ceil(points.length * eased))),
        alpha = fade * settle;

      strokeEdgePath(ctx, points, count, HOTSPOT_TRAIL_BLUE, 6.2, alpha * 0.1);
      strokeEdgePath(ctx, points, count, HOTSPOT_TRAIL_BLUE, 1.35, alpha * 0.58);

      const leadingCount = Math.max(3, Math.floor(points.length * 0.12)),
        start = Math.max(0, count - leadingCount),
        leading = points.slice(start, count);
      for (let index = 1; index < leading.length; index++) {
        const strength = index / Math.max(1, leading.length - 1);
        ctx.save();
        ctx.strokeStyle = HOTSPOT_LEAD_BLUE;
        ctx.globalAlpha = alpha * (0.28 + strength * 0.68);
        ctx.lineWidth = 2.15;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(leading[index - 1].x, leading[index - 1].y);
        ctx.lineTo(leading[index].x, leading[index].y);
        ctx.stroke();
        ctx.restore();
      }
      const head = leading.at(-1);
      if (head) {
        ctx.save();
        ctx.fillStyle = HOTSPOT_TRAIL_BLUE;
        ctx.globalAlpha = alpha * 0.2;
        ctx.beginPath();
        ctx.arc(head.x, head.y, 5.2, 0, TAU);
        ctx.fill();
        ctx.fillStyle = HOTSPOT_LEAD_BLUE;
        ctx.globalAlpha = alpha * 0.98;
        ctx.beginPath();
        ctx.arc(head.x, head.y, 1.8, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
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
      drawViewportFlight(elapsed, fade, transform);
      drawLoader(elapsed, fade, screenX, screenY);
      if (copyEl) copyEl.style.opacity = String(fade);
      placeText(screenX, screenY);
    }

    function show(anchor) {
      if (!ctx || !canvas || !anchor) return false;
      stop();
      const seed = ((Date.now() & 0xffffffff) ^ ((anchor.x * 2654435761) | 0) ^ ((anchor.y * 1597334677) | 0)) >>> 0,
        random = mulberry32(seed),
        type = pickLoaderType(random, lastType),
        transform = getTransform(),
        contentRects = getContentRects(),
        hotspot = getHotspot();
      lastType = type;
      model = {
        anchor:{ x:anchor.x, y:anchor.y },
        type,
        data:buildLoaderData(type, seed),
        flight:buildFlightModel(contentRects, hotspot, transform, random),
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
    HOTSPOT_FLASH_COUNT,
    HOTSPOT_FLASH_SECONDS,
    pickLoaderType,
    pickDifferentIndex,
    buildLoaderData,
    buildLoaderPoints,
    buildContentBlocks,
    hotspotOrbitPoints,
    hotspotFlashPulse,
    screenObstacleRects,
    buildFlightModel,
    advanceFlight,
    create,
  };
});
