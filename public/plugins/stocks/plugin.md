---
penecho-plugin: 1
id: stocks
name: Stocks
name-zh: A 股行情
version: 1
description: A-share quote summary, daily candles, volume, and basic valuation fields.
description-zh: 展示 A 股行情摘要、日线、成交量与基础估值字段。
category: Finance
category-zh: 金融
source: Tencent public quote endpoint
connect:
  - https://web.ifzq.gtimg.cn
recommended-refresh-seconds: 60
---

# Stocks

Use for a named or coded Shanghai/Shenzhen A-share, quote summary, or daily chart. This public webpage API is not a contracted stable market-data service; show delays/errors honestly and never frame output as investment advice.

## Output contract

Return exactly one `html_widget` command and no prose, with `pluginId:"stocks"`. Place it at the user's arrow/box destination or nearby blank space. Prefer `w:2600`, `h:1600`, `refreshSeconds:60`. Generate the responsive HTML yourself. Make name, code, latest price, and change dominant; draw a large daily close/candlestick trend with readable axes and concise fundamentals. Keep the outer layout transparent with no card background, border, or shadow.

## Data contract

Convert Shanghai codes (`.SH`, `.SS`, or leading 6) to `marketCode=sh{code}` and Shenzhen (`.SZ`, leading 0 or 3) to `marketCode=sz{code}`. For an unambiguous famous name, use its known code; otherwise show a clear request for a six-digit code rather than guessing.

Fetch JSON `GET https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={marketCode},day,,,60,qfq`. Read `data[marketCode]`. Its `qfqday` (fallback `day`) rows are `[date,open,close,high,low,volume]`. Its `qt[marketCode]` quote array uses index 1 name, 2 code, 3 latest, 4 previous close, 5 open, 6 volume, 30 quote time, 31 change, 32 change-percent, 33 high, 34 low, 37 amount, 38 turnover-percent, 39 PE, 44 total market value, 45 float market value, and 46 PB. Parse numeric strings and treat missing data as unavailable.

## Runtime rules

Fetch only declared origins with `credentials:"omit"`. The HTML owns fetching and its timer. No external assets, navigation, forms, cookies, storage, or secrets. Show source, market-data caveat, loading/error state, and last successful update. After every render call `window.parent.postMessage({type:"penecho-widget-updated"}, "*")`.

## One-shot example

User writes `贵州茅台 日线图` and points right. Use `sh600519` and produce one `html_widget` showing quote, change, 60 daily periods, volume, key valuation fields, source, and update time.
