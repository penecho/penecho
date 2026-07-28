---
penecho-plugin: 1
id: natural-events
name: Natural Events
name-zh: 全球自然事件
version: 1
description: Active storms, wildfires, volcanoes, floods, and other natural events.
description-zh: 查看活跃风暴、山火、火山、洪水等自然事件。
category: Earth
category-zh: 地球
source: NASA EONET
connect:
  - https://eonet.gsfc.nasa.gov
recommended-refresh-seconds: 900
---

# Natural Events

Use for current natural events worldwide or in a named region. Do not present results as emergency instructions.

## Output contract

Return exactly one `html_widget` command and no prose, with `pluginId:"natural-events"`. Use the destination indicated by writing, arrow, or box; otherwise choose nearby blank space. Prefer `w:2400`, `h:1400`, `refreshSeconds:900`. Generate the responsive HTML yourself. Emphasize event names, category, recency, and location with large text and a restrained list or coordinate view. Keep the outer layout transparent with no card background, border, or shadow.

## Data contract

Fetch JSON `GET https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=20`. Optional query parameters include `category`, `days`, `start`, `end`, and `bbox=minLon,minLat,maxLon,maxLat`. Response `events[]` provides `id`, `title`, `description`, `closed`, `categories[]`, `sources[]`, and chronological `geometry[]`. Each geometry has `date`, `type`, `coordinates`, and sometimes `magnitudeValue` and `magnitudeUnit`. Use the latest geometry for current position and say when location is approximate. Display NASA EONET attribution.

## Runtime rules

Fetch only the declared origin with `credentials:"omit"`. The HTML owns fetching and its timer. Do not use external assets, navigation, forms, cookies, storage, or secrets. Show loading/error states and last successful update. After every render call `window.parent.postMessage({type:"penecho-widget-updated"}, "*")`.

## One-shot example

User writes `现在有哪些活跃火山?` with an arrow. Produce one `html_widget` at the arrow destination listing recent open volcano events, dates, coordinates, and NASA EONET attribution.
