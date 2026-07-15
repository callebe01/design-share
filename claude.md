# design-share

A zero config CLI tool for design teams who ship code. Running `npx design-share` inside a repo gives the whole team a live board of every designer's branch, with in place previews and pinned comments. No accounts, no SaaS, no visible server. Git is the only backend.

## What it implements

This project implements idea 4 (the decided end to end flow) from the Claude Design wireframes "Branch Preview Tool" (project `2c3e16c6-f9d9-4089-a53b-0f8c02e7a3c9`):

* Stage 1 (4a): one command inside the repo. Repo detected from cwd, identity from git config, preview command auto detected silently. Zero questions unless detection genuinely fails.
* Stage 2 (4b): the Workbench dashboard. Left rail groups branches by person, center shows the live preview, right panel holds comments.
* Stage 3 (4c): the feedback loop. Comments pin to a point on screen and to a commit. When the author pushes, the pin flags that the branch changed so review and resolve close naturally.
* The macOS menu bar app (3a): a native Swift shell shipped inside the npm package. It keeps daemons alive after the terminal closes, shows the branch list and unread badge, and is offered by the CLI per wireframe 3c.

## Architecture summary

* Node CLI, zero runtime dependencies, Node 18 or newer.
* Shared team state (board shares + comments) lives in a hidden git ref `refs/design-share/state` that syncs through the repo's existing origin remote.
* Teammate previews run locally through hidden git worktrees under `.git/design-share/`. Clicking a teammate branch checks it out invisibly and runs its preview command.
* The dashboard is a static web app served by the local server. Vanilla JS, Linear style visual language, lucide icons inline as SVG, no emojis in product UI.

## Key files

* `bin/design-share.js` entry point for npx.
* `src/cli.js` command parsing, detection flow, terminal output.
* `src/detect.js` repo, identity and preview command detection.
* `src/state.js` git ref state storage, merge and sync.
* `src/previews.js` preview process manager and worktrees.
* `src/server.js` local http server, API and static hosting.
* `src/proxy.js` per preview injecting proxy (adds the inspector, passes websockets through).
* `src/github.js` open PR lookup through the gh CLI (no stored tokens).
* `public/inspect.js` in page inspector: hover highlight, element tooltips, element anchored pins.
* `src/registry.js` daemon registry in ~/.design-share for the menu bar app.
* `src/menubar.js` app install and launch helpers.
* `app/main.swift` the menu bar app; build with `scripts/build-app.sh` into `dist/DesignShare.app`.
* `public/` the Workbench dashboard (index.html, app.js, style.css).

## Conventions

* Zero runtime npm dependencies. Everything uses Node built ins.
* State documents merge by id with last write wins on `updatedAt`, so concurrent teammates converge without conflicts.
* Architecture decisions are logged under `/projects`. Task tracking lives under `/to-do`. Both folders stay out of version control.
