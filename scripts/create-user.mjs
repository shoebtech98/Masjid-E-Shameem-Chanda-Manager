/*
 * Create a real user account (Admin or Treasurer).
 *
 * This is the safe way to create the very first Admin on a fresh production
 * database, and to add individual accounts for committee members — instead of
 * relying on demo credentials (which are never created in production).
 *
 * Usage:
 *   npm run create-user -- --name "Asif Khan" --email asif@example.org --password "..." --role admin
 *   npm run create-user                       # interactive prompts
 *
 * The password is never echoed to the terminal or written to logs.
 */
import { readFileSync } from 'node:fs';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env (best-effort) before anything touches the database.
try {
  const { loadEnvFile } = await import('node:process');
  loadEnvFile();
} catch { /* no .env is fine */ }

const { db, createUser } = await import('../db.js');
const { logAudit } = await import('../lib/audit.js');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--name' || a === '--email' || a === '--password' || a === '--role') {
      out[a.slice(2)] = argv[i + 1];
      i += 1;
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    }
  }
  return out;
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

// Prompt for a password without echoing it to the terminal.
function askHidden(q) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(q);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\u0003') { process.stdout.write('\n'); process.exit(130); }       // Ctrl+C
        else if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(buf);
        } else if (ch === '\b' || ch === '\u007f') { buf = buf.slice(0, -1); }        // backspace
        else { buf += ch; }
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage:
  npm run create-user -- --name "Full Name" --email user@example.org --password "secret" [--role admin|treasurer]

Omitting --name/--email/--password starts an interactive prompt
(the password is typed without being echoed).`);
    process.exit(0);
  }

  let name = args.name;
  let email = args.email;
  let password = args.password;
  let role = args.role === 'admin' ? 'admin' : (args.role === 'treasurer' ? 'treasurer' : null);

  if (!name) name = (await ask('Full name: ')).trim();
  if (!email) email = (await ask('Email: ')).trim().toLowerCase();
  if (!role) {
    const r = (await ask('Role (admin/treasurer) [treasurer]: ')).trim().toLowerCase();
    if (r !== 'admin' && r !== 'treasurer') {
      console.error('Role must be "admin" or "treasurer".');
      process.exit(1);
    }
    if (r === 'admin') role = 'admin'; else role = 'treasurer';
  }
  if (!password) password = await askHidden('Password (min 8 characters, not echoed): ');
  if (!password) {
    console.error('A password is required.');
    process.exit(1);
  }

  rl.close();

  try {
    const user = createUser({ name, email, password, role });
    logAudit({
      userId: null,
      userName: 'setup',
      action: 'create',
      entity: 'user',
      entityId: user.id,
      description: `Created ${user.role} account for ${user.name} (${user.email}) via setup tool`,
    });
    console.log(`✓ Created ${user.role} account for ${user.name} (${user.email}).`);
    if (user.role === 'admin' && db.prepare('SELECT COUNT(*) c FROM users WHERE role = ?').get('admin').c === 1) {
      console.log('This is the first Admin account. Log in with this email and manage committee members from the Users page.');
    }
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }
}

main();
