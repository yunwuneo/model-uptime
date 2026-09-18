import { Store } from './store.js';
import { createApp } from './app.js';
import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
const store = new Store(process.env.DATA_DIR ?? './data');
const { app, worker } = createApp(store, { worker: process.env.RUN_WORKER !== 'false' });
const port = Number(process.env.PORT ?? 3001),
  host = process.env.HOST ?? '127.0.0.1';
const server = app.listen(port, host, () =>
  console.log(`Lumen is ready at http://${host}:${port}`),
);
const pruneTimer = setInterval(() => store.prune(), 3600000);
pruneTimer.unref();
store.prune();
let exiting = false;
async function shutdown() {
  if (exiting) return;
  exiting = true;
  clearInterval(pruneTimer);
  server.close();
  await worker.drain();
  store.close();
  process.exit(0);
}
process.on('SIGTERM', () => {
  void shutdown();
});
process.on('SIGINT', () => {
  void shutdown();
});
