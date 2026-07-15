import { execFile } from 'node:child_process';

export function git(repoRoot, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd: repoRoot,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...opts.env },
    }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error((stderr || err.message).trim());
        e.code = err.code;
        e.stderr = stderr;
        reject(e);
      } else {
        resolve(stdout.replace(/\n$/, ''));
      }
    });
  });
}

export function gitInput(repoRoot, args, input, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, {
      cwd: repoRoot,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...opts.env },
    }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error((stderr || err.message).trim());
        e.stderr = stderr;
        reject(e);
      } else {
        resolve(stdout.replace(/\n$/, ''));
      }
    });
    child.stdin.end(input);
  });
}

export async function tryGit(repoRoot, args, opts = {}) {
  try {
    return await git(repoRoot, args, opts);
  } catch {
    return null;
  }
}
