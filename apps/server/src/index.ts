import { createRealtimeServer } from './app';
import { config } from './config';

const server = createRealtimeServer(config);
server.http.listen(config.port, () => {
  console.log(`[carriage-corner] realtime on :${config.port}  run=${config.runSec.join('–')}s dwell=${config.dwellSec}s`);
});

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
