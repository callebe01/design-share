import { execFile } from 'node:child_process';

// PR links come from the gh CLI so no tokens are stored or handled: gh uses
// whoever is already logged in. Machines without gh (or without auth) simply
// return an empty map and the dashboard shows no PR links.
export function listOpenPRs(repoRoot) {
  return new Promise((resolve) => {
    execFile('gh', [
      'pr', 'list', '--state', 'open', '--limit', '200',
      '--json', 'number,url,headRefName,title',
    ], { cwd: repoRoot, timeout: 15_000 }, (err, stdout) => {
      if (err) return resolve({});
      try {
        const byBranch = {};
        for (const pr of JSON.parse(stdout)) {
          byBranch[pr.headRefName] = { number: pr.number, url: pr.url, title: pr.title };
        }
        resolve(byBranch);
      } catch {
        resolve({});
      }
    });
  });
}
