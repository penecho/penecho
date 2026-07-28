---
penecho-plugin: 1
id: weather
name: Weather
name-zh: 天气
version: 1
description: Current conditions and a five-day forecast for a named place.
description-zh: 查询指定地点的当前天气与五日预报。
category: Environment
category-zh: 环境
source: Open-Meteo
connect:
  - https://geocoding-api.open-meteo.com
  - https://api.open-meteo.com
recommended-refresh-seconds: 900
---

# Weather

Use when the user asks for current weather, temperature, humidity, wind, precipitation, or a short forecast for a named place. Do not use for historical climate analysis or emergency weather guidance.

## Output contract

Return exactly one `html_widget` command and no prose, with `pluginId:"weather"`. Place it in the blank canvas area indicated by the user's writing, arrow, or box; otherwise place it near the request without covering existing content. Prefer `w:2400`, `h:1400`, and `refreshSeconds:900`.

Generate a complete responsive HTML document in `html`; the plugin provides data knowledge, not a template. Use inline CSS and JavaScript only. Show the requested place, current conditions, units, a five-day forecast, linked Open-Meteo attribution, loading/error states, and the last successful update time. Follow `widgetRenderingPolicy`: emphasize the current condition, keep text large, and use a transparent outer layout with no card background or shadow.

## Data contract

1. Resolve the place with JSON `GET https://geocoding-api.open-meteo.com/v1/search?name={encodedPlace}&count=1&language={userLanguage}&format=json`. Use a sensible first result from `results[]`: `name`, `latitude`, `longitude`, `admin1`, `country`, `timezone`.

2. Fetch JSON `GET https://api.open-meteo.com/v1/forecast?latitude={latitude}&longitude={longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=5&timezone=auto`.

Read values and units from `current`, `current_units`, `daily`, and `daily_units`; daily fields are parallel arrays. WMO codes: `0` clear; `1-3` cloud; `45,48` fog; `51-57` drizzle; `61-67` rain; `71-77` snow; `80-86` showers; `95-99` storms.

## Runtime rules

Fetch only the declared origins with `credentials:"omit"`. The HTML owns its initial fetch and 900-second refresh timer; PenEcho never proxies or refreshes data. Do not use external assets, navigation, forms, cookies, storage, or secrets. After every success or error render, call `window.parent.postMessage({type:"penecho-widget-updated"}, "*")` so PNG export receives the current view.

## One-shot example

User writes `上海天气` and points to an empty area. Produce one `html_widget` there titled `上海天气`; its generated HTML resolves Shanghai, shows current conditions plus five forecast days, refreshes every 900 seconds, and follows all runtime rules above.
