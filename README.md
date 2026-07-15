# design-share

Live branch previews and pinned comments for design teams who ship code. One command inside your repo puts every designer's branch on a shared board, with live previews and Figma style comments. No accounts, no SaaS, no visible server. Git is the only backend.

```
npx design-share
```

```
  ✓ repo: acme-web (cwd)
  ✓ you: Sara (git config)
  ✓ previews: npm run dev (auto detected)

  › dashboard: http://localhost:4400
  share sara/checkout-v2 with the team board? (Y/n)
```

## Why

Branches are invisible unless you already think like an engineer. The latest design work lives on a branch, yet finding it requires GitHub, branch names, deployment URLs and tribal knowledge. design-share turns every open branch into something you can see, click and comment on.

## What you get

* **The board.** A left rail grouped by person shows every shared branch. Clicking one opens its live preview in place.
* **Previews without checkout.** Opening a teammate's branch silently checks it out into a hidden worktree inside `.git` land and runs the repo's preview command there. Your own working copy is never touched.
* **Pinned comments.** Click anywhere on a live preview to pin a note. Pins anchor to the exact spot, the viewport and the commit.
* **A loop that closes itself.** When the author pushes, open pins flag "updated since pin" so "is this fixed?" is never a question. Mark fixed, reply, done.
* **Zero setup for the team.** Identity comes from git config, the repo from your working directory, the preview command from package.json. The one question that detection may need (how previews run) is asked once per repo and saved to a committed `.design-share.json`.

## How it works

* Shared state (who shared what, plus every comment) lives in a hidden git ref, `refs/design-share/state`, pushed and fetched through the origin remote the team already uses. Any git host works. Nothing new to run or pay for.
* Teammates converge automatically: state documents merge by id with last write wins, so two designers commenting at the same time never conflict.
* Previews run locally on each viewer's machine, so a teammate's preview survives the author closing their laptop.

## Commands

```
npx design-share            start the board for this repo
npx design-share share      share your current branch with the team board
npx design-share status     show what is running
```

Flags: `--port <n>` (default 4400), `--no-open`, `--yes`.

## The menu bar app (macOS)

The first run offers it, and `npx design-share app` installs it any time. It is a tiny native app (about 1MB, bundled in this package, nothing else to download) that lives in the menu bar:

* keeps your board and previews alive after the terminal closes, and brings them back automatically
* shows every repo's branches with open comment counts, one click from the dashboard
* badges the icon when teammates pin comments on your shared branches
* optional launch at login

Quitting with Ctrl+C in the terminal is respected as a deliberate stop. Closing the terminal window is treated as an accident, and the app revives the board within seconds.

## Honest notes
* Opening a teammate's branch runs that branch's preview command on your machine, the same trust model as checking it out yourself.
* Worktree previews borrow the root `node_modules` when possible. Branches that change dependencies may need an install inside `.design-share/worktrees/<branch>`.
* "Updated since pin" compares commits today. Pixel level diffing is on the roadmap.

## Requirements

Node 18 or newer, git, and a repo with an origin remote (solo local mode works without one).
