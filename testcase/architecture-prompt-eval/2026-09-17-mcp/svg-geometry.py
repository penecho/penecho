#!/usr/bin/env python3
"""Read-only diagnostics for this experiment's flat, static SVG outputs.

This is NOT a production renderer or an acceptance oracle. Browser text metrics,
paint order and semantic ownership still require real rendered review. Unsupported
transforms/curves are reported rather than silently treated as verified.
"""
import json
import math
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET


def tag(e):
    return e.tag.rsplit('}', 1)[-1]


def diagnose(source):
    svg = ET.fromstring(re.search(r'<svg\b[\s\S]*?</svg>', source).group())
    excluded = {id(e) for d in svg.iter() if tag(d) == 'defs' for e in d.iter()}
    elements = [e for e in svg.iter() if id(e) not in excluded]
    transforms = [e.get('transform') for e in elements if e.get('transform')]
    if transforms:
        return {'supported': False, 'reason': 'transforms require browser measurement',
                'transforms': transforms}
    rects = []
    for e in elements:
        if tag(e) != 'rect' or not e.get('stroke'):
            continue
        b = [float(e.get(k, '0')) for k in ['x', 'y', 'width', 'height']]
        if b[2] >= 80 and b[3] >= 40:
            rects.append(b)
    contains = lambda a, b: a[0] <= b[0] and a[1] <= b[1] and a[0]+a[2] >= b[0]+b[2] and a[1]+a[3] >= b[1]+b[3]
    nodes = [a for a in rects if not any(a is not b and contains(a, b) for b in rects)]
    names = []
    for x, y, w, h in nodes:
        labels = [e for e in elements if tag(e) == 'text' and
                  x <= float(e.get('x', '-999')) <= x+w and
                  y <= float(e.get('y', '-999')) <= y+h]
        names.append(''.join(labels[0].itertext()) if labels else str([x, y, w, h]))

    def distance(p, b):
        x, y, w, h = b
        if x <= p[0] <= x+w and y <= p[1] <= y+h:
            return min(p[0]-x, x+w-p[0], p[1]-y, y+h-p[1])
        return math.hypot(max(x-p[0], 0, p[0]-x-w), max(y-p[1], 0, p[1]-y-h))

    paths, unsupported = [], []
    for e in elements:
        if tag(e) != 'path' or not e.get('stroke'):
            continue
        d = e.get('d', '')
        if re.search(r'[^ML\d\s,.\-]', d):
            unsupported.append(d)
            continue
        a = list(map(float, re.findall(r'-?\d+(?:\.\d+)?', d)))
        points = list(zip(a[::2], a[1::2]))
        if len(points) < 2:
            continue
        endpoints = []
        attached = set()
        for p in [points[0], points[-1]]:
            ds = [distance(p, b) for b in nodes]
            j = min(range(len(ds)), key=ds.__getitem__)
            endpoints.append({'point': p, 'nearest': names[j], 'gap': round(ds[j], 2)})
            if ds[j] <= 6:
                attached.add(j)
        crossings = []
        for j, (x, y, w, h) in enumerate(nodes):
            if j in attached:
                continue
            for (x1, y1), (x2, y2) in zip(points, points[1:]):
                vertical = x1 == x2 and x-0.5 <= x1 <= x+w+0.5 and min(y1,y2) < y+h-1 and max(y1,y2) > y+1
                horizontal = y1 == y2 and y-0.5 <= y1 <= y+h+0.5 and min(x1,x2) < x+w-1 and max(x1,x2) > x+1
                if vertical or horizontal:
                    crossings.append(names[j])
                    break
        paths.append({'d': d, 'endpoints': endpoints, 'unrelatedNodeCrossings': crossings})
    return {'supported': not unsupported, 'nodes': names, 'paths': paths,
            'unattachedEndpoints': [p for p in paths if any(e['gap'] > 6 for e in p['endpoints'])],
            'nodeCrossings': [p for p in paths if p['unrelatedNodeCrossings']],
            'unsupportedPaths': unsupported,
            'limitations': 'Flat SVG M/L geometry only. Does not verify text bounds, clipping, semantic relations, ownership, paint order or color.'}


if __name__ == '__main__':
    print(json.dumps(diagnose(Path(sys.argv[1]).read_text()), ensure_ascii=False, indent=2))
