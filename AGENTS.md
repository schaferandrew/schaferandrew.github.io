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

## The Crucible dashboard

The live Crucible dashboard now runs at `/crucible-dashboard/` in a separate repository
(`schaferandrew/crucible-dashboard`). The legacy Jekyll implementation (`crucible*.html`,
`assets/js/crucible*.js`, `_sass/pages/_crucible*.scss`, `_data/crucible/`, and `crucible-data/`)
has been retired. Old `/crucible/*` URLs redirect to the new dashboard.

- Publish results with `crucible publish` in the Crucible repo, then push the dashboard bundle.
- Do not add Crucible data or output files back to this repository.
