---
penecho-plugin: 1
id: exchange-rates
name: Exchange Rates
name-zh: 全球汇率
version: 1
description: Current reference exchange rates, conversion, and a recent historical trend.
description-zh: 展示参考汇率、金额换算与近期历史走势。
category: Finance
category-zh: 金融
source: Frankfurter
connect:
  - https://api.frankfurter.dev
recommended-refresh-seconds: 86400
---

# Exchange Rates

Use for fiat exchange rates, currency conversion, or recent daily trends. Explain that rates are reference values, not executable bank quotes.

## Output contract

Return exactly one `html_widget` command and no prose, with `pluginId:"exchange-rates"`. Place it at the requested destination or nearby blank space. Prefer `w:2400`, `h:1400`, `refreshSeconds:86400`. Generate the responsive HTML yourself. Make the requested converted amount or current rate dominant, show units clearly, and use a large simple trend if requested. Keep the outer layout transparent with no card background, border, or shadow.

## Data contract

For latest data fetch JSON `GET https://api.frankfurter.dev/v1/latest?base={BASE}&symbols={QUOTE1,QUOTE2}`. Response fields are `amount`, `base`, `date`, and `rates`. For history fetch `GET https://api.frankfurter.dev/v1/{start}..{end}?base={BASE}&symbols={QUOTE}`; `rates` is keyed by ISO date. Use ISO 4217 uppercase codes and calculate conversions in the browser. Data update on business days and may retain the previous date on weekends or holidays. Display the data date and Frankfurter attribution.

## Runtime rules

Fetch only the declared origin with `credentials:"omit"`. The HTML owns fetching and its daily timer. Do not use external assets, navigation, forms, cookies, storage, or secrets. Show loading/error states and last successful update. After every render call `window.parent.postMessage({type:"penecho-widget-updated"}, "*")`.

## One-shot example

User writes `100 美元等于多少人民币` and points below. Produce one `html_widget` below with the USD/CNY rate, converted amount, data date, and Frankfurter attribution.
