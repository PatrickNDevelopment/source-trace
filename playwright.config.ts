import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests run against the PRODUCTION build under the Pages prefix (/source-trace/) and
 * two real FastAPI backends on fresh temporary SQLite databases:
 *   8797  AI provider "fake" (deterministic, never touches a network)
 *   8798  AI not configured (the disabled-provider mode)
 * Locally the installed Microsoft Edge is used (no download); CI installs Chromium.
 */
const AI_PORT = 8797;
const NOAI_PORT = 8798;
const WEB_PORT = 4175;
const isWindows = process.platform === 'win32';
// The project's virtualenv when present (local development), otherwise the interpreter on PATH.
const venvPython = resolve(
  process.cwd(),
  isWindows ? '.venv\\Scripts\\python.exe' : '.venv/bin/python',
);
const python = existsSync(venvPython) ? venvPython : isWindows ? 'python' : 'python3';
const py = `"${python}"`;
const dataDir = mkdtempSync(join(tmpdir(), 'source-trace-e2e-'));
const origins = `http://localhost:${WEB_PORT},http://127.0.0.1:${WEB_PORT}`;

function backend(port: number, tag: string, extra: Record<string, string>) {
  return {
    command: `${py} -m source_trace`,
    cwd: 'backend',
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      SOURCE_TRACE_DB_PATH: join(dataDir, `${tag}.sqlite3`),
      SOURCE_TRACE_PORT: String(port),
      SOURCE_TRACE_HOST: '127.0.0.1',
      SOURCE_TRACE_CORS_ORIGINS: origins,
      SOURCE_TRACE_AI_LOG_PATH: join(dataDir, `${tag}-ai.log`),
      ...extra,
    },
  };
}

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}/source-trace/`,
    channel: process.env['CI'] ? undefined : 'msedge',
    trace: 'retain-on-failure',
    acceptDownloads: true,
  },
  webServer: [
    backend(AI_PORT, 'ai', { SOURCE_TRACE_AI_PROVIDER: 'fake' }),
    backend(NOAI_PORT, 'noai', {}),
    {
      command: 'npm run build && npm run preview',
      url: `http://localhost:${WEB_PORT}/source-trace/`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
