import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { detectRepo, detectIdentity, detectPreview, currentBranch, writeRepoConfig } from './detect.js';
import { StateStore } from './state.js';
import { PreviewManager } from './previews.js';
import { DesignShareServer } from './server.js';
import { upsertDaemon, removeDaemon, readUserConfig, writeUserConfig } from './registry.js';
import { appAvailable, appInstalled, installApp, launchApp } from './menubar.js';

const CLI_PATH = fileURLToPath(new URL('../bin/design-share.js', import.meta.url));

const VERSION = '0.1.0';
const DIM = '\x1b[2m', GREEN = '\x1b[32m', BLUE = '\x1b[36m', BOLD = '\x1b[1m', RESET = '\x1b[0m';
const ok = (msg) => console.log(`  ${GREEN}✓${RESET} ${msg}`);
const step = (msg) => console.log(`  › ${msg}`);
const dim = (msg) => console.log(`  ${DIM}${msg}${RESET}`);

function parseArgs(argv) {
  const args = { command: 'up', port: 4400, open: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') args.port = Number(argv[++i]) || 4400;
    else if (a === '--no-open') args.open = false;
    else if (a === '--yes') args.yes = true;
    else if (a === '--daemon') { args.daemon = true; args.open = false; }
    else if (a === '--version' || a === '-v') args.command = 'version';
    else if (a === '--help' || a === '-h') args.command = 'help';
    else if (!a.startsWith('-')) args.command = a;
  }
  return args;
}

function ask(question, fallback) {
  if (!process.stdin.isTTY) return Promise.resolve(fallback);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim() || fallback);
    });
  });
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start' : 'xdg-open';
  try { spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref(); } catch { /* non fatal */ }
}

function copyToClipboard(text) {
  if (process.platform !== 'darwin') return false;
  try {
    const p = spawn('pbcopy');
    p.stdin.end(text);
    return true;
  } catch { return false; }
}

async function findRunningInstance(repoRoot, basePort) {
  for (let port = basePort; port < basePort + 6; port++) {
    try {
      const res = await fetch(`http://localhost:${port}/api/board`, { signal: AbortSignal.timeout(600) });
      if (!res.ok) continue;
      const board = await res.json();
      if (board.repo && board.repo.root === repoRoot) return { port, board };
    } catch { /* not ours */ }
  }
  return null;
}

async function resolvePreviewConfig(repo) {
  let preview = detectPreview(repo.root);
  if (preview) return preview;

  console.log('');
  step('could not auto detect how previews should run for this repo.');
  const answer = await ask(
    `    how should previews run?\n      1) a command (like ${DIM}npm run dev${RESET})\n      2) serve a static folder\n    pick 1 or 2: `,
    null,
  );
  if (answer === '1') {
    const command = await ask('    command: ', null);
    if (!command) throw new Error('no command given. run npx design-share again when ready.');
    preview = { type: 'command', command, label: command };
  } else if (answer === '2') {
    const dir = await ask('    folder (relative to repo root, default "."): ', '.');
    preview = { type: 'static', dir, label: `static ${dir}` };
  } else {
    throw new Error('preview setup skipped. run npx design-share again when ready.');
  }
  const file = writeRepoConfig(repo.root, { preview: { type: preview.type, command: preview.command, dir: preview.dir, label: preview.label } });
  ok(`saved to ${file.replace(repo.root + '/', '')} — commit it so teammates are never asked`);
  return preview;
}

export async function run(argv) {
  const args = parseArgs(argv);

  if (args.command === 'version') { console.log(VERSION); return; }
  if (args.command === 'help') {
    console.log(`
  ${BOLD}design-share${RESET} — live branch previews and comments for design teams

  usage
    npx design-share            start the board for this repo
    npx design-share share      share your current branch with the team board
    npx design-share status     show what is running
    npx design-share app        install and launch the macOS menu bar app

  flags
    --port <n>    dashboard port (default 4400)
    --no-open     do not open the browser
    --yes         share your branch without asking
`);
    return;
  }

  if (args.command === 'app') {
    const target = await installApp();
    await launchApp();
    ok(`menu bar app installed at ${target} — look up ↗`);
    writeUserConfig({ appOffer: 'done' });
    return;
  }

  const repo = await detectRepo(process.cwd());
  const identity = await detectIdentity(repo.root);
  const branch = await currentBranch(repo.root);

  if (args.command === 'status') {
    const running = await findRunningInstance(repo.root, args.port);
    if (running) {
      ok(`design-share is running at http://localhost:${running.port} for ${running.board.repo.name}`);
    } else {
      dim('design-share is not running. start it with: npx design-share');
    }
    return;
  }

  console.log('');
  ok(`repo: ${BOLD}${repo.name}${RESET} ${DIM}(cwd)${RESET}`);
  ok(`you: ${BOLD}${identity.name}${RESET} ${DIM}(git config)${RESET}`);

  const preview = await resolvePreviewConfig(repo);
  const detectedNote = preview.source === 'config' ? 'from .design-share.json' : 'auto detected';
  ok(`previews: ${BOLD}${preview.label || preview.command || 'static'}${RESET} ${DIM}(${detectedNote})${RESET}`);

  const store = new StateStore(repo.root, identity);
  await store.init();

  if (args.command === 'share') {
    if (!branch) throw new Error('you are not on a branch (detached HEAD).');
    store.share({ branch });
    await store.sync();
    ok(`shared ${BOLD}${identity.slug}/${branch}${RESET} with the team board`);
    const snippet = `${identity.name} shared ${branch} on the ${repo.name} board — run: npx design-share`;
    if (copyToClipboard(snippet)) dim('slack snippet copied to your clipboard');
    return;
  }

  // default command: up
  const existing = await findRunningInstance(repo.root, args.port);
  if (existing) {
    ok(`already running at http://localhost:${existing.port}`);
    if (args.open) openBrowser(`http://localhost:${existing.port}`);
    return;
  }

  const previews = new PreviewManager(repo.root, preview, identity);
  const server = new DesignShareServer({ repo, identity, store, previews, port: args.port });
  const port = await server.listen();
  const url = `http://localhost:${port}`;

  upsertDaemon(repo.root, {
    port,
    pid: process.pid,
    name: repo.name,
    user: identity.slug,
    nodePath: process.execPath,
    cliPath: CLI_PATH,
    keepAlive: true,
  });

  console.log('');
  step(`dashboard: ${BLUE}${url}${RESET}`);
  if (branch) {
    previews.ensureOwn(branch).catch(() => { /* surfaced in dashboard */ });
    dim(`your preview of ${branch} is starting behind the scenes`);
  }
  store.sync().catch(() => { /* surfaced in dashboard */ });
  if (args.open) openBrowser(url);

  const key = branch ? `${identity.slug}/${branch}` : null;
  const alreadyShared = key && store.state.shares[key] && store.state.shares[key].active;
  if (branch && !alreadyShared && !args.daemon) {
    const answer = args.yes ? 'y' : await ask(`\n  share ${BOLD}${identity.slug}/${branch}${RESET} with the team board? (Y/n) `, 'y');
    if (answer.toLowerCase() !== 'n') {
      store.share({ branch });
      store.sync().catch(() => {});
      ok('shared — teammates just run: npx design-share');
      const snippet = `${identity.name} shared ${branch} on the ${repo.name} board — run: npx design-share`;
      if (copyToClipboard(snippet)) dim('slack snippet copied to your clipboard');
    } else {
      dim('just browsing. share later from the dashboard or: npx design-share share');
    }
  }

  if (!args.daemon) {
    if (appInstalled()) {
      launchApp().catch(() => {});
      console.log('');
      dim('menu bar app is watching this repo — previews survive closing this terminal.');
    } else if (appAvailable() && process.stdin.isTTY && readUserConfig().appOffer !== 'never') {
      console.log('');
      dim('tip: previews stop when this terminal closes.');
      const answer = await ask('  install the menu bar app to keep them alive? (y/N/never) ', 'n');
      if (answer.toLowerCase() === 'y') {
        await installApp();
        await launchApp();
        writeUserConfig({ appOffer: 'done' });
        ok('installed — look up ↗ the app adopts this repo automatically');
      } else if (answer.toLowerCase() === 'never') {
        writeUserConfig({ appOffer: 'never' });
        dim('ok, never asking again. npx design-share app changes your mind later.');
      }
    } else {
      console.log('');
      dim('tip: previews stop when this terminal closes. ctrl+c quits.');
    }
  }

  // Deliberate quit removes the daemon from the registry. A terminal that
  // simply closes sends SIGHUP; the entry stays so the menu bar app respawns
  // the daemon and previews come back without the terminal.
  const shutdown = (keepEntry) => () => {
    console.log('');
    dim('stopping previews and server…');
    if (!keepEntry) removeDaemon(repo.root);
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown(false));
  process.on('SIGTERM', shutdown(false));
  process.on('SIGHUP', shutdown(true));
}
