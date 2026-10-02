import { createApp } from './app.ts';
import { createChain } from './chain.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
// Deploy instances have disposable disks. Never silently start a development
// database or random session key when provider configuration is incomplete.
if (
  process.env.DENO_DEPLOY &&
  (!config.production ||
    !config.databaseUrl ||
    !config.apiOnly ||
    config.sessionTransport !== 'bearer')
)
  throw new Error(
    'Deno Deploy requires production PostgreSQL, API_ONLY=true, and SESSION_TRANSPORT=bearer',
  );
const app = await createApp({ config, chain: createChain(config) });
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(
      () => process.exit(1),
      process.env.DENO_DEPLOY ? 4000 : 10000,
    );
    deadline.unref();
    try {
      await app.close();
      process.exitCode = 0;
    } catch {
      process.exitCode = 1;
    } finally {
      clearTimeout(deadline);
    }
  });
await app.listen({ host: config.host, port: config.port });
