---
penecho-plugin: 1
id: earthquakes
name: Global Earthquakes
name-zh: 全球地震
version: 1
description: Recent earthquake activity, magnitude ranking, and location distribution.
description-zh: 展示近期地震活动、震级排行与位置分布。
category: Earth
category-zh: 地球
source: USGS
connect:
  - https://earthquake.usgs.gov
recommended-refresh-seconds: 60
---

# Global Earthquakes

Use for recent earthquakes, strongest events, or seismic activity near a region. Do not predict earthquakes or present this as emergency guidance.

## Output contract

Return exactly one `html_widget` command and no prose, with `pluginId:"earthquakes"`. Place it at the user's indicated destination or nearby blank space. Prefer `w:2400`, `h:1400`, `refreshSeconds:60`. Generate the complete responsive HTML yourself. Prioritize the strongest or requested event, use large readable text, and show a compact list or coordinate plot without an outer card, background, border, or shadow.

## Data contract

Fetch GeoJSON from `GET https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/{feed}.geojson`, choosing `all_hour`, `all_day`, `2.5_day`, or `4.5_week` according to the request; default to `all_day`. Read `metadata.generated`, and each feature's `properties.mag`, `place`, `time`, `updated`, `tsunami`, `felt`, `type`, plus `geometry.coordinates` as longitude, latitude, depth-km. Sort or filter in the browser. Display USGS attribution and distinguish preliminary data.

## Runtime rules

Fetch only the declared origin with `credentials:"omit"`. The HTML owns its initial fetch and refresh timer. Do not use external assets, navigation, forms, cookies, storage, or secrets. Show loading/error states and the last successful update time. After every render call `window.parent.postMessage({type:"penecho-widget-updated"}, "*")`.

## One-shot example

User writes `最近最强的地震` and points right. Produce one `html_widget` there with the strongest recent event, several runners-up, time, depth, location, and USGS attribution.
