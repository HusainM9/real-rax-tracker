import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { discoverTestProjects } from './scripts/test-projects.mjs'

const root = fileURLToPath(new URL('.', import.meta.url))
const files = discoverTestProjects(root)
const report = process.env.RAX_TEST_REPORT_FILE

// Test runs intentionally do not import vite.config.ts: that config loads the
// application's local service environment and development API middleware.
export default defineConfig({
  root,
  envDir: false,
  plugins: [react()],
  test: {
    reporters: report ? ['default', 'junit'] : ['default'],
    outputFile: report ? { junit: report } : undefined,
    projects: Object.entries(files).filter(([, include]) => include.length).map(([name, include]) => ({
      extends: true,
      test: {
        name,
        include,
        environment: name === 'ui' ? 'jsdom' : 'node',
        setupFiles: [name === 'integration' ? './tests/setup/offlineNetwork.ts' : './src/testing/offlineSetup.ts'],
      },
    })),
  },
})
