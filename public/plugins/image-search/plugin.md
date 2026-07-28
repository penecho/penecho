---
penecho-plugin: 1
id: image-search
name: Show Real Photos Online
name-zh: 显示网络真实照片
version: 1
description: Search Commons images with Openverse fallback.
description-zh: 搜索 Commons 真实图片，Openverse 备用。
category: Media
category-zh: 媒体
source: Wikimedia Commons + Openverse
connect:
  - https://commons.wikimedia.org
  - https://upload.wikimedia.org
  - https://api.openverse.org
recommended-refresh-seconds: 86400
---

# Show Real Photos Online

## Use

Use for real photos or illustrations; visibly show the actual images. Default to exactly 1 image. Use multiple only when requested, normally up to 5.

## Output

Return one `html_widget` and no prose, with inline HTML/CSS/JS, `pluginId:"image-search"`, `refreshSeconds:86400`, and a localized title. Do not return `copyText` or `copyLabel`; image search has no copy-source toolbar action.

## Sources

Both APIs need no key and allow browser CORS. Use `URLSearchParams` and `credentials:"omit"`.

- Primary: `https://commons.wikimedia.org/w/api.php` with `action=query`, `format=json`, `origin=*`, `generator=search`, `gsrsearch=<subject filetype:bitmap>`, `gsrnamespace=6`, `gsrlimit=<count>`, `prop=imageinfo`, `iiprop=url|mime|extmetadata`, `iiurlwidth=1200`. Add `headers:{"Api-User-Agent":"PenEcho-ImageSearch/1.0"}`. Sort pages by `index`; read `title`, `thumburl`, `url`, `descriptionurl`, `mime`, and `extmetadata` from `imageinfo[0]`.
- Fallback: `https://api.openverse.org/v1/images/` with `q=<subject>`, `page_size=<count>`, `mature=false`. Read `title`, `creator`, `license`, `provider`, `foreign_landing_url`, and `thumbnail`. Accept `thumbnail` only from exact origin `https://api.openverse.org`; do not load raw `url`, whose origin is unpredictable.

## Fallback

Request Commons once first. Keep two distinct candidates: `thumburl` first and `url` second. On error, switch once from `thumburl` to `url`. Only if Commons fails, is empty/short, or both URLs fail, make at most one Openverse search request for the whole refresh and fill failed cards by index. Never query per card or prefetch fallback. Otherwise show a placeholder.

## Runtime

For 429/503 or Commons 403 `Too many requests`, respect `Retry-After`; never loop-retry. Openverse quota is limited. Own/clear one daily timer. Show loading, error/empty, source, and update time. Strip metadata HTML via `textContent`. Each `<img>` needs alt, `crossorigin="anonymous"`, `referrerpolicy="no-referrer"`, and undistorted sizing. After images settle, post `{type:"penecho-widget-updated"}` so saved thumbnails and exports contain pixels.

## Layout

Use a responsive card grid. Make images dominant; show title, author, license, and whether the source is Commons or Openverse.

## One-shot example

For `给我看看极光图片`, emit one `html_widget` titled `极光图片` and render exactly one attributed result. For `给我看看五张极光图片`, use `count=5`.
