# Pinned commit — Project Horizon submission

The judged tree is the current **HEAD of `main`** on
https://github.com/omere-svg/real-news, as pushed for the Demo Day submission
(the submission pass: proposal aligned to the product directive, intent tests
added, docs reconciled — 749 tests + 2 env-gated live, coverage 96.3%/85.83%).
No hash is hardcoded here because this note ships inside that same commit; read
the exact SHA straight from the repo.

Verify and archive it directly:

```
git clone https://github.com/omere-svg/real-news && cd real-news
git rev-parse HEAD          # the exact judged commit
git archive --format=zip -o project-horizon.zip HEAD
```

The deployed instance at https://horizon-news.duckdns.org runs `main` — CI
deploys only from `main` after typecheck + lint + the full gated test suite pass,
with a health-checked rollback (`/health` returns `{"ok":true}`).
