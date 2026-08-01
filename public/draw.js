"use strict";
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PENECHO_DRAW = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  const TYPES = new Set(["line", "smooth", "rect", "ellipse", "circle", "arc"]),
    MAX_ITEMS = 64,
    MAX_VALUES = 2048,
    MAX_RASTER_PIXELS = 12000000,
    MAX_RASTER_SIDE = 4096;

  const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
  const copyPoint = (point) => ({ x: point.x, y: point.y });
  const includePoint = (bounds, point) => {
    bounds.left = Math.min(bounds.left, point.x);
    bounds.top = Math.min(bounds.top, point.y);
    bounds.right = Math.max(bounds.right, point.x);
    bounds.bottom = Math.max(bounds.bottom, point.y);
  };
  const flatPoints = (values, origin) => {
    const points = [];
    for (let index = 0; index < values.length; index += 2) points.push({ x: origin[0] + values[index], y: origin[1] + values[index + 1] });
    return points;
  };
  const cubicAt = (start, control1, control2, end, t) => {
    const inverse = 1 - t;
    return inverse ** 3 * start + 3 * inverse ** 2 * t * control1 + 3 * inverse * t ** 2 * control2 + t ** 3 * end;
  };
  function cubicExtrema(start, control1, control2, end) {
    const a = -start + 3 * control1 - 3 * control2 + end,
      b = 2 * (start - 2 * control1 + control2),
      c = control1 - start,
      roots = [];
    if (Math.abs(a) < 1e-9) {
      if (Math.abs(b) >= 1e-9) roots.push(-c / b);
    } else {
      const discriminant = b * b - 4 * a * c;
      if (discriminant >= 0) {
        const root = Math.sqrt(discriminant);
        roots.push((-b + root) / (2 * a), (-b - root) / (2 * a));
      }
    }
    return roots.filter((value) => value > 0 && value < 1);
  }
  function includeCubic(bounds, segment) {
    includePoint(bounds, segment.from);
    includePoint(bounds, segment.to);
    const values = new Set([
      ...cubicExtrema(segment.from.x, segment.c1.x, segment.c2.x, segment.to.x),
      ...cubicExtrema(segment.from.y, segment.c1.y, segment.c2.y, segment.to.y),
    ]);
    for (const t of values) {
      includePoint(bounds, {
        x: cubicAt(segment.from.x, segment.c1.x, segment.c2.x, segment.to.x, t),
        y: cubicAt(segment.from.y, segment.c1.y, segment.c2.y, segment.to.y, t),
      });
    }
  }
  const TAU = Math.PI * 2;
  const normalizeAngle = (angle) => ((angle % TAU) + TAU) % TAU;
  function angleOnSweep(angle, start, sweep) {
    if (Math.abs(sweep) >= TAU) return true;
    const distance = sweep > 0 ? normalizeAngle(angle - start) : normalizeAngle(start - angle);
    return distance <= Math.abs(sweep) + 1e-9;
  }
  function includeArc(bounds, primitive) {
    if (Math.abs(primitive.sweep) >= TAU) {
      includePoint(bounds, { x: primitive.cx - primitive.rx, y: primitive.cy - primitive.ry });
      includePoint(bounds, { x: primitive.cx + primitive.rx, y: primitive.cy + primitive.ry });
      return;
    }
    const angles = [primitive.start, primitive.start + primitive.sweep, 0, Math.PI / 2, Math.PI, Math.PI * 1.5];
    for (const angle of angles) {
      if (!angleOnSweep(angle, primitive.start, primitive.sweep)) continue;
      includePoint(bounds, { x: primitive.cx + primitive.rx * Math.cos(angle), y: primitive.cy + primitive.ry * Math.sin(angle) });
    }
  }
  function smoothSegments(points, closed, tension) {
    if (points.length < 3) return [];
    const segments = [], count = closed ? points.length : points.length - 1, strength = tension / 50 / 6;
    for (let index = 0; index < count; index++) {
      const p1 = points[index],
        p2 = points[(index + 1) % points.length],
        p0 = closed ? points[(index - 1 + points.length) % points.length] : points[Math.max(0, index - 1)],
        p3 = closed ? points[(index + 2) % points.length] : points[Math.min(points.length - 1, index + 2)],
        c1 = { x: p1.x + (p2.x - p0.x) * strength, y: p1.y + (p2.y - p0.y) * strength },
        c2 = { x: p2.x - (p3.x - p1.x) * strength, y: p2.y - (p3.y - p1.y) * strength };
      segments.push({ from: p1, c1, c2, to: p2 });
    }
    return segments;
  }
  function arrowGeometry(end, tangentFrom, width) {
    const angle = Math.atan2(end.y - tangentFrom.y, end.x - tangentFrom.x), size = Math.max(18, width * 2.2), spread = 0.52;
    return [
      copyPoint(end),
      { x: end.x - size * Math.cos(angle - spread), y: end.y - size * Math.sin(angle - spread) },
      { x: end.x - size * Math.cos(angle + spread), y: end.y - size * Math.sin(angle + spread) },
    ];
  }
  function terminalTangentFrom(primitive) {
    const end = primitive.points.at(-1), candidates = [];
    if (primitive.segments.length) {
      for (let index = primitive.segments.length - 1; index >= 0; index--) {
        const segment = primitive.segments[index];
        candidates.push(segment.c2, segment.c1, segment.from);
      }
    } else {
      for (let index = primitive.points.length - 2; index >= 0; index--) candidates.push(primitive.points[index]);
    }
    return candidates.find((point) => Math.hypot(end.x - point.x, end.y - point.y) > 1e-6) || null;
  }
  function indexSet(value, count) {
    if (value === undefined) return new Set();
    if (!Array.isArray(value) || value.length > count) return null;
    const result = new Set();
    for (const index of value) {
      if (!integer(index, 0, count - 1) || result.has(index)) return null;
      result.add(index);
    }
    return result;
  }
  function normalize(command, canvasSize = 20000) {
    if (!command || typeof command !== "object" || !Array.isArray(command.origin) || command.origin.length !== 2 || !command.origin.every((value) => integer(value, 0, canvasSize))) return null;
    if (!Array.isArray(command.types) || !Array.isArray(command.items) || !command.types.length || command.types.length !== command.items.length || command.types.length > MAX_ITEMS) return null;
    const width = command.width === undefined ? 30 : command.width,
      tension = command.tension === undefined ? 50 : command.tension;
    if (!integer(width, 2, 200) || !integer(tension, 0, 100)) return null;
    const closed = indexSet(command.closed, command.items.length),
      fill = indexSet(command.fill, command.items.length),
      arrows = indexSet(command.arrows, command.items.length);
    if (!closed || !fill || !arrows) return null;
    const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }, primitives = [];
    let valueCount = 0;
    for (let index = 0; index < command.items.length; index++) {
      const type = command.types[index], item = command.items[index];
      if (!TYPES.has(type) || !Array.isArray(item) || !item.every((value) => integer(value, -canvasSize, canvasSize))) return null;
      valueCount += item.length;
      if (valueCount > MAX_VALUES) return null;
      const primitive = { type, closed: closed.has(index), fill: fill.has(index), arrow: arrows.has(index) };
      if (type === "line" || type === "smooth") {
        if (item.length < 4 || item.length % 2 || item.length > 512) return null;
        primitive.points = flatPoints(item, command.origin);
        if (primitive.closed && primitive.points.length < 3) return null;
        primitive.segments = type === "smooth" ? smoothSegments(primitive.points, primitive.closed, tension) : [];
        if (primitive.segments.length) primitive.segments.forEach((segment) => includeCubic(bounds, segment));
        else primitive.points.forEach((point) => includePoint(bounds, point));
        if (primitive.fill && !primitive.closed) return null;
        if (primitive.arrow && primitive.closed) return null;
        if (primitive.arrow) {
          const end = primitive.points.at(-1),
            tangentFrom = terminalTangentFrom(primitive);
          if (!tangentFrom) return null;
          primitive.arrowPoints = arrowGeometry(end, tangentFrom, width);
          primitive.arrowPoints.forEach((point) => includePoint(bounds, point));
        }
      } else if (type === "rect") {
        if (item.length !== 4 || !integer(item[2], 1, canvasSize) || !integer(item[3], 1, canvasSize) || primitive.closed || primitive.arrow) return null;
        primitive.x = command.origin[0] + item[0];
        primitive.y = command.origin[1] + item[1];
        primitive.w = item[2];
        primitive.h = item[3];
        includePoint(bounds, { x: primitive.x, y: primitive.y });
        includePoint(bounds, { x: primitive.x + primitive.w, y: primitive.y + primitive.h });
      } else if (type === "ellipse") {
        if (item.length !== 4 || !integer(item[2], 1, canvasSize) || !integer(item[3], 1, canvasSize) || primitive.closed || primitive.arrow) return null;
        primitive.cx = command.origin[0] + item[0];
        primitive.cy = command.origin[1] + item[1];
        primitive.rx = item[2];
        primitive.ry = item[3];
        includePoint(bounds, { x: primitive.cx - primitive.rx, y: primitive.cy - primitive.ry });
        includePoint(bounds, { x: primitive.cx + primitive.rx, y: primitive.cy + primitive.ry });
      } else if (type === "circle") {
        if (item.length !== 3 || !integer(item[2], 1, canvasSize) || primitive.closed || primitive.arrow) return null;
        primitive.cx = command.origin[0] + item[0];
        primitive.cy = command.origin[1] + item[1];
        primitive.rx = primitive.ry = item[2];
        includePoint(bounds, { x: primitive.cx - primitive.rx, y: primitive.cy - primitive.ry });
        includePoint(bounds, { x: primitive.cx + primitive.rx, y: primitive.cy + primitive.ry });
      } else {
        if (item.length !== 6 || !integer(item[2], 1, canvasSize) || !integer(item[3], 1, canvasSize) || !integer(item[4], -3600, 3600) || !integer(item[5], -3600, 3600) || item[5] === 0 || primitive.closed || primitive.fill) return null;
        primitive.cx = command.origin[0] + item[0];
        primitive.cy = command.origin[1] + item[1];
        primitive.rx = item[2];
        primitive.ry = item[3];
        primitive.start = (item[4] * Math.PI) / 180;
        primitive.sweep = (item[5] * Math.PI) / 180;
        includeArc(bounds, primitive);
        if (primitive.arrow) {
          const endAngle = primitive.start + primitive.sweep,
            end = { x: primitive.cx + primitive.rx * Math.cos(endAngle), y: primitive.cy + primitive.ry * Math.sin(endAngle) },
            direction = primitive.sweep > 0 ? 1 : -1,
            tangentFrom = { x: end.x + direction * primitive.rx * Math.sin(endAngle) * 0.1, y: end.y - direction * primitive.ry * Math.cos(endAngle) * 0.1 };
          primitive.arrowPoints = arrowGeometry(end, tangentFrom, width);
          primitive.arrowPoints.forEach((point) => includePoint(bounds, point));
        }
      }
      primitives.push(primitive);
    }
    if (bounds.left < 0 || bounds.top < 0 || bounds.right > canvasSize || bounds.bottom > canvasSize) return null;
    const pad = Math.ceil(width / 2 + 4),
      imageBounds = {
        x: Math.max(0, Math.floor(bounds.left - pad)),
        y: Math.max(0, Math.floor(bounds.top - pad)),
        right: Math.min(canvasSize, Math.ceil(bounds.right + pad)),
        bottom: Math.min(canvasSize, Math.ceil(bounds.bottom + pad)),
      };
    imageBounds.w = Math.max(1, imageBounds.right - imageBounds.x);
    imageBounds.h = Math.max(1, imageBounds.bottom - imageBounds.y);
    return {
      tool: "draw",
      origin: [...command.origin],
      types: [...command.types],
      items: command.items.map((item) => [...item]),
      closed: [...closed].sort((a, b) => a - b),
      fill: [...fill].sort((a, b) => a - b),
      arrows: [...arrows].sort((a, b) => a - b),
      width,
      tension,
      x: imageBounds.x,
      y: imageBounds.y,
      _draw: { primitives, bounds: imageBounds },
    };
  }
  function trace(context, primitive) {
    if (primitive.type === "line") {
      context.moveTo(primitive.points[0].x, primitive.points[0].y);
      for (const point of primitive.points.slice(1)) context.lineTo(point.x, point.y);
      if (primitive.closed) context.closePath();
    } else if (primitive.type === "smooth") {
      context.moveTo(primitive.points[0].x, primitive.points[0].y);
      if (primitive.segments.length) for (const segment of primitive.segments) context.bezierCurveTo(segment.c1.x, segment.c1.y, segment.c2.x, segment.c2.y, segment.to.x, segment.to.y);
      else context.lineTo(primitive.points[1].x, primitive.points[1].y);
      if (primitive.closed) context.closePath();
    } else if (primitive.type === "rect") context.rect(primitive.x, primitive.y, primitive.w, primitive.h);
    else if (primitive.type === "circle" || primitive.type === "ellipse") context.ellipse(primitive.cx, primitive.cy, primitive.rx, primitive.ry, 0, 0, Math.PI * 2);
    else context.ellipse(primitive.cx, primitive.cy, primitive.rx, primitive.ry, 0, primitive.start, primitive.start + primitive.sweep, primitive.sweep < 0);
  }
  function render(command, createCanvas, color = "#2563eb") {
    const prepared = command?._draw ? command : normalize(command);
    if (!prepared) return null;
    const bounds = prepared._draw.bounds,
      logicalWidth = bounds.w,
      logicalHeight = bounds.h,
      rasterScale = Math.min(1, MAX_RASTER_SIDE / logicalWidth, MAX_RASTER_SIDE / logicalHeight, Math.sqrt(MAX_RASTER_PIXELS / (logicalWidth * logicalHeight))),
      rasterWidth = Math.max(1, Math.floor(logicalWidth * rasterScale)),
      rasterHeight = Math.max(1, Math.floor(logicalHeight * rasterScale)),
      scaleX = rasterWidth / logicalWidth,
      scaleY = rasterHeight / logicalHeight,
      image = createCanvas(rasterWidth, rasterHeight),
      context = image.getContext("2d");
    context.setTransform(scaleX, 0, 0, scaleY, -bounds.x * scaleX, -bounds.y * scaleY);
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = prepared.width;
    context.lineCap = context.lineJoin = "round";
    for (const primitive of prepared._draw.primitives) {
      context.beginPath();
      trace(context, primitive);
      if (primitive.fill) {
        context.save();
        context.globalAlpha = 0.14;
        context.fill();
        context.restore();
      }
      context.stroke();
      if (primitive.arrowPoints) {
        context.beginPath();
        context.moveTo(primitive.arrowPoints[0].x, primitive.arrowPoints[0].y);
        context.lineTo(primitive.arrowPoints[1].x, primitive.arrowPoints[1].y);
        context.lineTo(primitive.arrowPoints[2].x, primitive.arrowPoints[2].y);
        context.closePath();
        context.fill();
      }
    }
    image.logicalWidth = logicalWidth;
    image.logicalHeight = logicalHeight;
    image.revealRows = [logicalWidth];
    image.revealRowHeight = logicalHeight;
    return { image, x: bounds.x, y: bounds.y };
  }
  return {
    normalize,
    render,
    smoothSegments,
  };
});
