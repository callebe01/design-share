#!/usr/bin/env node
const major = Number(process.versions.node.split('.')[0]);
if (major < 18) {
  console.error(`\n  design-share needs Node 18 or newer. You are on ${process.versions.node}.`);
  console.error('  Update at https://nodejs.org and run npx design-share again.\n');
  process.exit(1);
}

const { run } = await import('../src/cli.js');

run(process.argv.slice(2)).catch((err) => {
  console.error(`\n  \x1b[31m✕\x1b[0m ${err.message}`);
  if (process.env.DS_DEBUG) console.error(err.stack);
  process.exit(1);
});
