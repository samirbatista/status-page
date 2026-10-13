import { createApp } from './app.js';
import { loadApiEnv } from './env.js';

const env = loadApiEnv();
const app = await createApp(env);
await app.listen(env.API_PORT, '0.0.0.0');
