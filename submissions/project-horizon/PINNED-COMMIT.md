# Pinned commit — Project Horizon submission

The judged tree is the `main` branch of https://github.com/omere-svg/real-news as pushed
for Demo Day (2026-07-07). Verify and archive it directly:

```
git clone https://github.com/omere-svg/real-news && cd real-news
git rev-parse HEAD          # the exact judged commit
git archive --format=zip -o project-horizon.zip HEAD
```

The deployed instance at https://horizon-news.duckdns.org runs the same commit — CI
deploys only from `main` after typecheck + lint + the full gated test suite pass.
