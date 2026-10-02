import Database from 'better-sqlite3';
import { chmod, mkdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorCode } from './errors.ts';

export async function backupDatabase(
  source: string,
  destination: string,
): Promise<string> {
  if (
    !isAbsolute(source) ||
    !isAbsolute(destination) ||
    resolve(source) === resolve(destination)
  )
    throw new Error(
      'Backup requires distinct absolute source and destination paths',
    );
  try {
    await stat(destination);
    throw new Error('Backup destination already exists');
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const db = new Database(source, {
    readonly: true,
    fileMustExist: true,
    timeout: 5000,
  });
  try {
    await db.backup(destination);
    await chmod(destination, 0o600);
    const copy = new Database(destination, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      if (copy.pragma('integrity_check', { simple: true }) !== 'ok')
        throw new Error('Backup integrity verification failed');
    } finally {
      copy.close();
    }
  } finally {
    db.close();
  }
  return destination;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [source, destination, ...extra] = process.argv.slice(2);
  if (!source || !destination || extra.length)
    throw new Error(
      'Usage: npm run backup -- /absolute/database.sqlite /absolute/backup.sqlite',
    );
  await backupDatabase(source, destination);
  console.log('SQLite backup completed and integrity verified.');
}
