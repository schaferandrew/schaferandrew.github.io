# AGENTS.md

Instructions for any coding agent working on this site (Andrew Schafer's Jekyll portfolio,
served by GitHub Pages at www.schaferandrew.com).

## Deploying

- Pushing `master` is the deploy: GitHub Pages rebuilds the site in a minute or two. Work on a
  branch and open a PR unless the user asks for a direct push.
- Never commit `_site/`. It's Jekyll's build output, rewritten every time `bundle exec jekyll
  serve` runs (`.gitignore` lists it, but a few files are tracked from before). Stage paths
  explicitly instead of `git add -A`.
- Preview locally with `bundle exec jekyll serve` (http://localhost:4000).

## The Crucible dashboard (`/crucible/`)

- It stays out of the navbar, `noindex`, with its under-construction notice, until the user
  says otherwise.
- Its data is the results bundles in `_data/crucible/` (one JSON file per machine, written by
  `crucible publish` in the Crucible repo; schema in that repo's
  `crucible/schemas/results.schema.json`). Never hand-edit a bundle; republish it.
- Publishing results: run `crucible publish` in the Crucible repo, then commit and push only
  `_data/crucible/` here.
- The page logic is `assets/js/crucible.js`, styles `_sass/pages/_crucible.scss`, pages
  `crucible.html` and `crucible-about.html`.
