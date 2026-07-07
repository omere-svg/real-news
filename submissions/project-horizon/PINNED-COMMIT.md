# Pinned commit — Project Horizon submission

The judged tree is the `main` branch of https://github.com/omere-svg/real-news as pushed
for Demo Day (2026-07-07). The exact judged commit is:

```
2b918aa   hardening pass: self-tuning reflection loop, daily spend guard, structured brief, safety guards
```

Verify and archive it directly:

```
git clone https://github.com/omere-svg/real-news && cd real-news
git rev-parse HEAD          # should print 2b918aa… (or a later main HEAD if I kept iterating)
git archive --format=zip -o project-horizon.zip HEAD
```

The deployed instance at https://horizon-news.duckdns.org runs this commit — CI
deploys only from `main` after typecheck + lint + the full gated test suite pass
(this commit's runs: CI ✓, Deploy to VM ✓; `/health` returns `{"ok":true}`).
