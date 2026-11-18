# Scoring model

Implemented in [`packages/shared/src/scoring.ts`](../packages/shared/src/scoring.ts) and shared by the
API, worker and web app, so every surface computes scores identically.

## Category score

Every finding is one *check*. A check has a **weight** set by its severity and earns **credit** by status:

| Severity | Weight |     | Status  | Credit |
| -------- | ------ | --- | ------- | ------ |
| critical | 10     |     | passed  | 1.0    |
| high     | 6      |     | warning | 0.5    |
| medium   | 3      |     | failed  | 0      |
| low      | 1      |     |         |        |
| info     | 0      |     |         |        |

```
score = round( 100 * sum(weight * credit) / sum(weight) )
```

- Informational findings are reported but never move the score.
- Passed checks count, so a site is rewarded for what it does right, not only penalised for failures.
- Worked example: one failed critical + one passed low = `100 * (0 + 1) / (10 + 1) = 9`.
- If nothing scorable exists the result is `null` (the category becomes *unavailable*), not 0 or 100.
- An analyzer may supply its own score (the Performance analyzer will use the Lighthouse score from PageSpeed
  Insights). Otherwise the orchestrator derives it with the formula above. The pass/fail/warning counts are
  always recomputed from the findings.

## Overall score

Weighted mean of **completed** categories, weights re-normalised over the ones that contributed:

| Category       | Weight |
| -------------- | ------ |
| performance    | 0.25   |
| seo            | 0.20   |
| accessibility  | 0.20   |
| security       | 0.20   |
| best-practices | 0.15   |

If Performance is unavailable (e.g. no API key), the remaining four weights are scaled to sum to 1. The report
exposes `scoredCategories` so the UI can say "based on 4 of 5 categories". A category that is `unavailable`
or `failed` is **never** treated as 0. If no category completed, the overall score is `null` and the audit is `failed`.

## Audit status

`completed` = all 5 categories scored · `partial` = at least one, but not all · `failed` = none.
