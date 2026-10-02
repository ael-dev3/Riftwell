import { loadConfig } from './config.ts';
import { openStore } from './database.ts';

const config = loadConfig();
if (!config.databaseUrl)
  throw new Error('The hosted migration requires DATABASE_URL');
const database = await openStore(config);
try {
  const result = await database.get<{ version: number }>(
    'SELECT version FROM riftwell_schema',
  );
  if (result?.version !== 2) throw new Error('Unsupported database schema');
  console.info('Riftwell PostgreSQL schema is ready.');
} finally {
  await database.close();
}
