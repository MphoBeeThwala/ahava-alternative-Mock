# Clinical evaluation

Measures whether changes to the clinical reasoning pipeline (prompt, rules,
reference data, calibration, model) make the output better or worse, section by
section: **diagnosis, investigations, management, calibration, safety**.

## Two modes

| | Offline (`pnpm eval:clinical`) | Live (`pnpm eval:clinical:live`) |
|---|---|---|
| Calls a model | No | Yes (spends API credit; TEST keys only) |
| Runs in CI | Every PR (`ci.yml`, and inside `pnpm test`) | Manual: *Actions > Clinical evaluation (live model)* |
| Catches | A guardrail, rule, reference file, calibration rule, validator or scorer change that stops a complete plan passing, or stops a thin plan being caught | The model or prompt getting worse at the actual clinical task |
| Fails when | A recording no longer meets its `expect` block, or a "good" recording falls below `thresholds.json` | A section is below `thresholds.json`, or drops more than `maxRegression` below `baseline.json` |

Offline mode cannot tell you the model is good. It proves the safety net still
works. A model regression only shows up in a live run.

## Layout

```
eval/
  cases/<id>.json          gold case: input + per-section rubric
  recorded/<id>/*.json     recorded model outputs, each with an `expect` block
  thresholds.json          minimum per-section score, allowed regression
  baseline.json            (created by a live run) last accepted live scores
```

Each recording has a `kind`: **good** (a complete plan; must meet the
thresholds), **weak** (a deliberately thin plan; the guards must still catch
it), or **live** (saved by `--record`, reported but not gated).

**The two HIV-HLH-001 recordings are synthetic**: written to reproduce the
original failure and its fix. Replace them with real model outputs
(`pnpm eval:clinical:live -- --record`, then have a clinician review and promote
one to `good`/`weak`).

## How scoring works

An output is parsed and run through the production post-processing (validation,
dose stripping, completeness linter, blocked terms, calibration). Rubric items
are then checked against the result. A section score is the weight of passed
items over the total weight. Rubric item kinds are in `src/eval/clinicalEval.ts`
(`match`, `forbidden`, `decision`, `timing`, `questionsAnswered`,
`tiersPopulated`, plus built-ins for calibration and safety).

Pack cases (`--pack set1|set2|all`, from `docs/diagnostic-test-pack`) get a
generic rubric (structure, calibration, safety). Their diagnosis section is
scored by the AI judge against the published answer key.

## Adding a case

1. Copy `cases/hiv-hlh-001.json`; give it a new `id`. Keep `status` as
   `gold_draft_pending_clinician_review` until a clinician has reviewed every
   rubric item.
2. Put structured values (vitals, labs) under `input.findings`; the free-text
   history under `input.caseText`. Include any questions the case asks.
3. Add one `good` and one `weak` recording under `recorded/<id>/` with `expect`
   blocks (see the existing ones). Run `pnpm eval:clinical`.
4. Run it live once with test keys and `--update-baseline`.

## Status and limits

* Only one gold case so far. One case is not enough to trust a score; add more
  across specialities before relying on this to gate a launch.
* Rubrics are draft clinical content. A passing score means "meets the rubric",
  not "clinically correct".
* The diagnosis check for gold cases is keyword-based and strict about wording;
  extend the `anyOf` lists rather than loosening the thresholds.
