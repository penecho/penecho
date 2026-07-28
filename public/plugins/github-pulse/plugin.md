---
penecho-plugin: 1
id: github-pulse
name: GitHub Pulse
name-zh: GitHub 项目脉搏
version: 1
description: Repository stars, forks, issues, release, language, and recent activity.
description-zh: 展示仓库 Star、Fork、Issue、版本、语言与活跃度。
category: Developer
category-zh: 开发者
source: GitHub REST API
connect:
  - https://api.github.com
recommended-refresh-seconds: 600
---

# GitHub Pulse

Use when the user names a public GitHub `owner/repo` and asks for project status or popularity. Never request or embed a token.

## Output contract

Return exactly one `html_widget` command and no prose, with `pluginId:"github-pulse"`. Place it at the indicated destination or nearby blank area. Prefer `w:2400`, `h:1400`, `refreshSeconds:600`. Generate the complete responsive HTML yourself. Make repository name, stars, and freshness prominent; use large text and concise secondary metrics. Keep the outer layout transparent with no card background, border, or shadow.

## Data contract

Fetch JSON `GET https://api.github.com/repos/{owner}/{repo}`. Available fields include `full_name`, `description`, `stargazers_count`, `forks_count`, `open_issues_count`, `subscribers_count`, `language`, `license.spdx_id`, `topics`, `created_at`, `updated_at`, `pushed_at`, `archived`, and `default_branch`. Optionally fetch `GET /repos/{owner}/{repo}/releases/latest`; treat 404 as no release. Anonymous GitHub REST access is limited to 60 requests per user IP per hour, so make no more than these two requests per refresh. Display GitHub attribution and the remaining quota from response headers when available.

## Runtime rules

Fetch only the declared origin with `credentials:"omit"`. The HTML owns fetching and its timer. Do not use external assets, navigation, forms, cookies, storage, Authorization headers, or secrets. Show loading/error states and last successful update. After every render call `window.parent.postMessage({type:"penecho-widget-updated"}, "*")`.

## One-shot example

User writes `penecho/penecho 项目数据` and points right. Produce one `html_widget` there showing repository summary, stars, forks, issues, language, latest activity/release, and GitHub attribution.
