import { createApp } from './app.mjs';
import { createChain } from './chain.mjs';
import { loadConfig } from './config.mjs';

const config = loadConfig();
const app = await createApp({ config, chain: createChain(config) });
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => process.exit(1), 10000);
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
