// Manage encrypted API keys in the database. Run from the Coolify terminal:
//   npm run secrets -- import /tmp/keys.env   (KEY=value lines; FILL_ME and empty lines are skipped)
//   npm run secrets -- set NAME VALUE
//   npm run secrets -- delete NAME
//   npm run secrets -- list                   (names only, never values)
// Delete the imported file afterwards.

import { readFileSync } from 'node:fs';
import { deleteSecret, listSecretNames, setSecret } from '../lib/secrets';

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'import' && a) {
    let n = 0;
    for (const line of readFileSync(a, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m || !m[2] || m[2].startsWith('FILL_ME')) continue;
      if (m[1] === 'DATABASE_URL' || m[1] === 'SECRETS_ENCRYPTION_KEY') continue;
      await setSecret(m[1], m[2]);
      n++;
    }
    console.log(`Stored ${n} keys (encrypted).`);
  } else if (cmd === 'set' && a && b) {
    await setSecret(a, b);
    console.log(`Stored ${a}.`);
  } else if (cmd === 'delete' && a) {
    await deleteSecret(a);
    console.log(`Deleted ${a}.`);
  } else if (cmd === 'list') {
    console.log((await listSecretNames()).join('\n') || '(none)');
  } else {
    console.log('Usage: import <file> | set NAME VALUE | delete NAME | list');
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
