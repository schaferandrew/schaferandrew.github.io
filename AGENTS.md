# AGENTS.md

Instructions for any coding agent working on this site (Andrew Schafer's Jekyll portfolio,
served by GitHub Pages at www.schaferandrew.com).

## Deploying

- Pushing `master` is the deploy: GitHub Pages rebuilds the site in a minute or two. Work on a
  branch and open a PR unless the user asks for a direct push.
- Never commit `_site/`. It's Jekyll's build output, rewritten every time `bundle exec jekyll
  serve` runs (`.gitignore` lists it, but a few files are tracked from before). Stage paths
  explicitly instead of `git add -A`.
- Local preview: Ruby 3.3.12 (pinned in `.ruby-version`; `rbenv install 3.3.12`), then
  `bundle install && bundle exec jekyll serve` (http://localhost:4000). The Gemfile uses the
  `github-pages` gem, so it builds with the same Jekyll and plugins as Pages.

## The Crucible dashboard (`/crucible/`)

- It has launched: no under-construction notice. It stays out of the navbar and `noindex` until
  the user says otherwise.
- By default only tasks the selected suite makes active are shown. Provisional tasks' runs stay in
  the data but don't appear (no cells, no tier columns, no counts); a task appears once a suite makes
  it active. Two exceptions, both opt-in:
  - The main page's "Include provisional tasks" switch (`&provisional=1` in the hash, or
    `?provisional=1`; remembered per browser in localStorage, the link wins) builds the section with
    `S.view(mode, { provisional: true })`: provisional tasks get matrix columns (dashed, `is-provisional`)
    and count toward a setup's tier and overall scores only where it ran them, so the board re-ranks.
    Coverage, partial and "in progress" stay judged on the active tasks alone; a tier result's `prov`
    says how many provisional tasks it folded in. A note says the scores aren't comparable to the
    suite, each row says "ran n of m provisional tasks", and the takeaways always read the default
    view (counted scores only). Off is exactly the suite as cut. It isn't a filter: it sits outside
    the control panel, in its own amber "Preview" strip (`#prov-box`) between the panel and the
    takeaways, so it never joins the Section/Suite row (a no-wrap row: a third field squeezes them).
  - The task page's "Show provisional tasks" toggle (`&provisional=1`) lists them in its index. A
    provisional task's own page always opens from a direct link, clearly marked provisional.
- Its data is bundle format 3 in `_data/crucible/`, written by `crucible publish` in the Crucible
  repo (that repo's `docs/bundle-format.md`; schemas in `crucible/schemas/`): `catalog/v<N>.json`
  per suite, and one file per run (`runs/<month>/`), score record (`scores/<month>/`) and status
  record (`status/`). Full model outputs are in `crucible-data/outputs/`, outside `_data`. Never
  hand-edit any of it; republish, and run `crucible publish --check` before committing.
- `_data/crucible/corrections.json` (from the Crucible repo's `corrections.yaml`, written by `crucible
  publish`) says how to read runs whose model fields were recorded badly. `applyCorrections` in
  `crucible-core.js` applies it once, as runs are read, and nothing else re-implements it: a listed
  base is read as its corrected one, a listed maker or publisher fills only an empty field, an empty
  format is filled from a quant only one format uses, and the run detail says what was recorded.
  Fix a name there, never in the page or the runs.
- `_data/crucible_display.yml` holds display settings, read through `crucible/data.json`.
  `hidden_suites` lists suite IDs (a catalog's `suite.id`, e.g. `v1`) the page treats as not
  selectable: they're left out of the suite selector, and a `#…&suite=<id>` link falls back to the
  current visible suite. With one suite visible the selector isn't drawn, but the suite line is.
  Remove an ID to bring that suite back; its catalog and runs stay in `_data/crucible/`.
  `energy` prices local runs, which nobody bills: a local run's cost is its time × `watts[hardware
  key]` × `usd_per_kwh`, shown with ≈ as an electricity estimate. Add a machine's watts when it starts
  serving models; without it, its local cost shows as a dash and it's left off the cost chart.
- Publishing results: run `crucible publish` in the Crucible repo, then commit and push only
  `_data/crucible/` and `crucible-data/` here.
- The page is data-driven. Never hard-code a task, area, mode, tier, label, blurb or threshold in
  `crucible.js`, `crucible.html` or `crucible-about.html`: they come from the bundle's catalog
  (`modes`, `areas`, `tiers` with `role`/`gate`, `scoring_policy`, per-task `weight`). The only
  literals allowed are display fallbacks kept in `_data/crucible_fallbacks.yml` (keyed by ID) and
  used only when the catalog lacks the field.
- Unknown data renders generically and never throws: an unknown tier, area, mode, harness, enum
  value or field is shown with its raw ID (capitalized), after the known ones, and a tier with no
  `role` never headlines or gates. A run of a task the selected suite's catalog doesn't list is
  kept but not counted, and is listed under "Other runs" in the model detail.
- The page joins the records itself: a run counts in a suite when the suite pins its task (active)
  at the run's task version, through one of its mode's harnesses, and no status record marks it
  invalid or withdrawn; its score is its score record at the suite's pinned rubric version.
  Leaderboard rows are a base model at a reasoning level, scored by their single best
  configuration; repeats are a mean with n and range.
- The main page's Combined tab (`#combined`, `C.COMBINED`, built by `buildCombinedView` in the core;
  label from `combined` in the fallbacks) adds the sections together: each tier is its section scores
  summed (out of 10 per section), the overall score sums those. Its rows join one setup per section that
  differs only in harness (same model, packager, format, quant, reasoning, runtime or provider, machine);
  a model missing a section isn't ranked. It shows the leaderboard and scatter only, not the matrix or heatmap.
- Respect `format_version`: `SUPPORTED_FORMAT` in `crucible.js` (and `cr_supported` in
  `_includes/crucible-catalog.html`) is the highest the page understands. A newer record or catalog is
  skipped with a one-line notice, never an error; a higher `format_revision` is always safe.
  Raise `SUPPORTED_FORMAT` only together with the code that reads the new format.
- Publishing only adds files to `_data/crucible/`: never edit or delete a run or a bundle by hand.
- The page doesn't inline the data. `crucible/data.json` (generated by Jekyll from
  `_data/crucible/` and the fallbacks, with score records slimmed to their totals) is fetched after
  first paint, with a loading and an error state; `crucible/details.json` (full score records) and
  `crucible-data/outputs/<run_uuid>.txt` are fetched only when a run is opened. Below 640 px every table is one card per row (leaderboard, matrix, heatmap, model
  detail), and only one layout is ever on the page; check both 1400 px and 375 px after any change.
- Pages: `/crucible/` (`crucible.html`), `/crucible/about/`, `/crucible/todo/` (setups with scored tasks left, sorted by how easy they are to finish, and a pick of what to run next), and three detail pages routed by the hash:
  `/crucible/task/#<task-id>`, `/crucible/compare/#<slug>,<slug>`, and one model hierarchy:
  `/crucible/model/` (publishers), `/crucible/model/#<maker>` (a publisher's models),
  `/crucible/model/#<maker>/<model>` (`#-/<model>` when the maker is unknown), with variant and
  deployment as `&variant=`/`&deployment=` params. Each page is `crucible-<page>.html` with its own
  `assets/js/crucible-<page>.js` and `_sass/pages/_crucible-<page>.scss`. Everything they share (loading,
  suite selection, the record join and counting rules, leaderboard rows, formatting, the run detail
  panel, the router and URL helpers) is in `assets/js/crucible-core.js` (`window.CrucibleCore`); a page
  never re-implements the join. Main page styles are `_sass/pages/_crucible.scss`. Every page includes
  `_includes/crucible-nav.html`, the Crucible-only tab strip (not the site navbar): add a new page to its
  list; the core keeps the reader's `&suite=` on its links.
- Publisher means the maker, the lab that trained the model: a run's `model.origin.maker` (Crucible 3.5.0
  on), else inferred from the prefix of `model.base` and shown as inferred. `model.publisher` is the
  weight packager (mlx-community, lmstudio-community...), never the maker. There's no maker label list:
  makers show as recorded. Wherever a model appears, its maker links to its publisher page
  (`/crucible/model/#<maker>`). Where the packager matters, the page says "Packaged by <model.publisher>".
- Every selector and filter is in one control panel above the takeaways (`#control-panel`): Section
  and Suite first, then the filters (Overall score tiers, Models, Hardware, Format, Quant, Packager,
  Reasoning, Harness where a section has several, Show finished/in progress), then a footer with the
  active-filter chips, the notes and Reset filters (clears every filter; section and suite stay).
  Below 640 px the filters fold behind a "Filters (n on)" button; the chips stay visible. The filters
  scope everything below the panel. They narrow setups before each row's
  best setup is picked (`passesFilters` in `crucible.js`), so a row shows its best matching setup or
  drops out. They drill down: each filter's options are what the *other* filters leave, with how many
  rows each would show (counted like the board: in-progress models only when shown), so no choice
  empties the board; a filter with one option is hidden, and Cloud clears the weights filters.
  Hardware, Format, Quant, Packager and Reasoning are multi-select (`FILTERS` in `crucible.js`): a
  button summing up the choice opens a list with "Show all" first, then each value with a dot (filled
  when picked) and its row count; values within a filter are OR, filters are AND. Hardware's values
  are hardware keys (chip/GPU + memory, e.g. `m5-pro-48gb`), with the machines' names shown beside
  them. Active filters show as removable chips (one per value) after "Showing N of M models", and all
  of them live in the hash, multi-select ones as comma lists (`&where=local&quant=q4_k_m,mlx-4bit`).
- The leaderboard's column chart (`renderBars`) plots the same rows' headline score, best first
  (partial and in-progress last, like the table), coloured local/cloud as on the scatter, hatched when
  partial; columns are capped at 24 px in slots of at most 56 px, names angled under the axis with the
  reasoning level kept ("model · on"). Below 640 px it's one horizontal bar per row with its name above.
- Setups are a variant (quant/format, reasoning, and harness where a mode has several: changes the answer) on a deployment (machine or provider, local or cloud: changes speed and cost). Quality compares variants; speed and cost compare deployments of one variant. An A/B only differs in one variant setting on one recorded deployment, over tasks both sides finished; a timeout or error is reliability, not a 0 in a comparison (the suite's scores keep their rule); a run with no recorded machine is its own "machine not recorded" deployment, left out of A/Bs and speed and cost; no headline difference on fewer than C.MIN_PAIRED_TASKS shared tasks or when one task drives most of it.
