import { stdin, stderr, stdout, exit } from 'process';

import { createAdminPasswordHash } from '../../backend/src/admin.js';

function printUsage() {
  stderr.write(
    [
      'Usage:',
      '  pnpm run admin:hash-password',
      '  pnpm run admin:hash-password -- --stdin',
      '',
      'The generated hash is printed to stdout. The plaintext password is never printed.',
      '',
    ].join('\n')
  );
}

async function readAllStdin() {
  stdin.setEncoding('utf-8');
  let value = '';

  for await (const chunk of stdin) {
    value += chunk;
  }

  return value.replace(/\r?\n$/, '');
}

function readHiddenLine(prompt) {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY) {
      reject(new Error('Interactive password prompt requires a TTY. Use --stdin instead.'));
      return;
    }

    stderr.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf-8');
    let value = '';

    function cleanup() {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      stderr.write('\n');
    }

    function onData(chunk) {
      for (const char of chunk) {
        if (char === '\u0003') {
          cleanup();
          reject(new Error('Password prompt cancelled.'));
          return;
        }

        if (char === '\r' || char === '\n') {
          cleanup();
          resolve(value);
          return;
        }

        if (char === '\b' || char === '\u007f') {
          value = value.slice(0, -1);
          return;
        }

        value += char;
      }
    }

    stdin.on('data', onData);
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  let password;
  if (args.includes('--stdin')) {
    password = await readAllStdin();
  } else {
    const first = await readHiddenLine('Admin password: ');
    const second = await readHiddenLine('Confirm admin password: ');
    if (first !== second) {
      throw new Error('Passwords did not match.');
    }
    password = first;
  }

  const hash = await createAdminPasswordHash(password);
  stdout.write(`${hash}\n`);
}

try {
  await main();
} catch (error) {
  stderr.write(`${error instanceof Error ? error.message : 'Could not generate hash.'}\n`);
  exit(1);
}
