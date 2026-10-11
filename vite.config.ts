import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { loadEnv, type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

function localApiPlugin(): Plugin {
  return {
    name: 'local-api-routes',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const originalUrl = req.url ?? ''
        const url = new URL(originalUrl, 'http://localhost')
        if (!url.pathname.startsWith('/api/')) {
          next()
          return
        }

        const apiPath = `${url.pathname.slice(1)}.ts`
        const apiFile = path.resolve(apiPath)
        if (!fs.existsSync(apiFile)) {
          next()
          return
        }

        try {
          const chunks: Buffer[] = []
          for await (const chunk of req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
          }
          const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined
          const headers = new Headers()
          for (const [key, value] of Object.entries(req.headers)) {
            if (Array.isArray(value)) {
              for (const item of value) headers.append(key, item)
            } else if (value !== undefined) {
              headers.set(key, value)
            }
          }

          type WebHandler = (request: Request) => Promise<Response> | Response
          const module = (await server.ssrLoadModule(apiFile)) as {
            default?: WebHandler | { fetch?: WebHandler }
            GET?: WebHandler
            POST?: WebHandler
            PUT?: WebHandler
            PATCH?: WebHandler
            DELETE?: WebHandler
            localWebHandler?: WebHandler
          }
          const methodHandler = module[(req.method?.toUpperCase() || 'GET') as keyof typeof module]
          const handler = typeof module.localWebHandler === 'function'
            ? module.localWebHandler
            : typeof methodHandler === 'function'
              ? methodHandler
              : typeof module.default === 'function'
                ? module.default
                : module.default?.fetch
          if (typeof handler !== 'function') {
            next()
            return
          }

          const request = new Request(`http://localhost${originalUrl}`, {
            method: req.method,
            headers,
            body: body ? Readable.toWeb(Readable.from(body)) : undefined,
            duplex: body ? 'half' : undefined,
          } as RequestInit)
          const response = await handler(request)

          res.statusCode = response.status
          response.headers.forEach((value, key) => res.setHeader(key, value))
          const responseBody = response.body
          if (!responseBody) {
            res.end()
            return
          }
          const buffer = Buffer.from(await response.arrayBuffer())
          res.end(buffer)
        } catch (error) {
          server.ssrFixStacktrace(error as Error)
          next(error)
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  for (const [key, value] of Object.entries(env)) {
    let next = value
    if (
      (next.startsWith('"') && next.endsWith('"') && next.length >= 2) ||
      (next.startsWith("'") && next.endsWith("'") && next.length >= 2)
    ) {
      next = next.slice(1, -1)
    }
    process.env[key] ??= next
  }

  return {
    plugins: [localApiPlugin(), react()],
  test: {
    environment: 'jsdom',
  },
  }
})
