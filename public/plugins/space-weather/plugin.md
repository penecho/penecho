---
penecho-plugin: 1
id: space-weather
name: Space Weather
name-zh: 太空天气
version: 1
description: Planetary Kp index, geomagnetic activity, and a concise aurora signal.
description-zh: 展示 Kp 指数、地磁活动与极光参考信号。
category: Space
category-zh: 太空
source: NOAA SWPC
connect:
  - https://services.swpc.noaa.gov
recommended-refresh-seconds: 300
---

# Space Weather

Use for current geomagnetic conditions, Kp history, or a broad aurora activity signal. Do not promise aurora visibility or replace local forecasts.

## Output contract

Return exactly one `html_widget` command and no prose, with `pluginId:"space-weather"`. Place it where the user indicates or in nearby blank space. Prefer `w:2400`, `h:1400`, `refreshSeconds:300`. Generate the responsive HTML yourself. Make the latest Kp value and qualitative activity level dominant, with a large 24-hour trend. Keep text highly readable and the outer layout transparent with no card background, border, or shadow.

## Data contract

Fetch JSON `GET https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json`. The first row is a header; later rows contain `time_tag`, `Kp`, `a_running`, and `station_count`. Convert numeric strings, reject invalid rows, sort chronologically, and use the latest row. Interpret Kp below 4 as quiet/unsettled, 4 as active, 5 as G1, 6 as G2, 7 as G3, 8 as G4, and 9 as G5. State that Kp is planetary-scale and aurora visibility also depends on location, darkness, and clouds. Display NOAA SWPC attribution.

## Runtime rules

Fetch only the declared origin with `credentials:"omit"`. The HTML owns its initial fetch and timer. Do not use external assets, navigation, forms, cookies, storage, or secrets. Show loading/error states and last successful update. After every render call `window.parent.postMessage({type:"penecho-widget-updated"}, "*")`.

## One-shot example

User writes `现在有极光机会吗?` and points below. Produce one `html_widget` below showing latest Kp, activity level, trend, caveat, and NOAA attribution.
