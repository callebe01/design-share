import { execFile } from 'node:child_process';

// PR links come from the gh CLI so no tokens are stored or handled: gh uses
// whoever is already logged in. Machines without gh (or without auth) simply
// return an empty map and the dashboard shows no PR links.
// Read only PR detail for the header panel: description plus conversation.
export function prDetail(repoRoot, number) {
  return new Promise((resolve) => {
    execFile('gh', [
      'pr', 'view', String(number),
      '--json', 'number,title,body,state,author,url,createdAt,comments',
    ], { cwd: repoRoot, timeout: 15_000 }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        const d = JSON.parse(stdout);
        resolve({
          number: d.number,
          title: d.title,
          body: d.body || '',
          state: d.state,
          url: d.url,
          author: (d.author && d.author.login) || '',
          createdAt: d.createdAt,
          comments: (d.comments || []).map((c) => ({
            author: (c.author && c.author.login) || '',
            body: c.body || '',
            createdAt: c.createdAt,
          })),
        });
      } catch {
        resolve(null);
      }
    });
  });
}

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
