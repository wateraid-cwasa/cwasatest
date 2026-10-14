import 'dotenv/config';
import * as argon2 from 'argon2';
import { PrismaMssql } from '@prisma/adapter-mssql';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { PrismaClient } from '../dist/generated/platform/client.js';

function readHidden(prompt) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new Error('Run this one-time bootstrap from an interactive terminal.');
  }

  stdout.write(prompt);
  stdin.setEncoding('utf8');
  stdin.setRawMode(true);
  stdin.resume();

  return new Promise((resolve, reject) => {
    let value = '';
    const onData = (character) => {
      if (character === '\u0003') {
        cleanup();
        reject(new Error('Bootstrap cancelled.'));
        return;
      }
      if (character === '\r' || character === '\n') {
        cleanup();
        stdout.write('\n');
        resolve(value);
        return;
      }
      if (character === '\u007f' || character === '\b') {
        value = value.slice(0, -1);
        return;
      }
      if (character >= ' ') {
        value += character;
        stdout.write('*');
      }
    };
    const cleanup = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    stdin.on('data', onData);
  });
}

const databaseUrl = process.env.PLATFORM_DATABASE_URL;
if (!databaseUrl || databaseUrl.includes('REPLACE_WITH')) {
  throw new Error('PLATFORM_DATABASE_URL is required. Configure it in backend/.env.');
}

const prisma = new PrismaClient({ adapter: new PrismaMssql(databaseUrl) });
const readline = createInterface({ input: stdin, output: stdout });

try {
  if ((await prisma.adminAccount.count()) > 0) {
    throw new Error('An administrator already exists; bootstrap can only run once.');
  }

  const username = (await readline.question('Admin username: ')).trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,100}$/.test(username)) {
    throw new Error('Username must be 3-100 characters: lowercase letters, numbers, dot, underscore, or hyphen.');
  }
  readline.close();

  const password = await readHidden('Admin password (minimum 12 characters): ');
  if (password.length < 12 || password.length > 128) {
    throw new Error('Password must be between 12 and 128 characters.');
  }

  await prisma.adminAccount.create({
    data: {
      username,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
    },
  });
  stdout.write('Administrator account created. No plaintext password was stored.\n');
} finally {
  readline.close();
  await prisma.$disconnect();
}
