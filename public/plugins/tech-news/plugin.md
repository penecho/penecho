---
penecho-plugin: 1
id: tech-news
name: Tech News
name-zh: 科技新闻
version: 1
description: Hacker News front page or recent stories matching a requested technology topic.
description-zh: 展示 Hacker News 首页或指定科技主题的近期新闻。
category: News
category-zh: 新闻
source: Hacker News Algolia
connect:
  - https://hn.algolia.com
recommended-refresh-seconds: 900
---

# Tech News

Use for current technology news, Hacker News headlines, or recent stories on a named tech topic. This source reflects one community and is not a complete or neutral news survey.

## Output contract

Return exactly one `html_widget` command and no prose, with `pluginId:"tech-news"`. Place it at the user's destination or nearby blank space. Prefer `w:2600`, `h:1600`, `refreshSeconds:900`. Generate the responsive HTML yourself. Show 6-10 highly relevant headlines with large text, age, source domain, score, and comments; make the requested topic prominent. Keep the outer layout transparent with no card background, border, or shadow.

## Data contract

For the front page fetch JSON `GET https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=10`. For a topic fetch `GET https://hn.algolia.com/api/v1/search_by_date?query={encodedTopic}&tags=story&hitsPerPage=10`. Response `hits[]` can include `objectID`, `title`, `url`, `author`, `points`, `num_comments`, `created_at`, and `created_at_i`. Filter missing titles, deduplicate, and use `url` only to extract a display hostname; do not create navigation. Display Hacker News/Algolia attribution and label the selected view as community-ranked or newest.

## Runtime rules

Fetch only the declared origin with `credentials:"omit"`. The HTML owns fetching and its timer. Do not use external assets, navigation, forms, cookies, storage, or secrets. Show loading/error states and last successful update. After every render call `window.parent.postMessage({type:"penecho-widget-updated"}, "*")`.

## One-shot example

User writes `今天 AI 有什么新闻` and points below. Produce one `html_widget` below showing recent AI-related story titles, age, source, score/comments, source caveat, and update time.
