import { next } from '@vercel/functions'

export const config = {
  matcher: ['/((?!assets/|robots\\.txt).*)'],
}

function unauthorized(): Response {
  return new Response('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="RAX OTD Tracker", charset="UTF-8"',
    },
  })
}

function decodeBasicAuth(header: string): { user: string; password: string } | null {
  const [scheme, encoded] = header.split(' ')
  if (scheme !== 'Basic' || !encoded) return null

  try {
    const decoded = atob(encoded)
    const separator = decoded.indexOf(':')
    if (separator < 0) return null
    return {
      user: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    }
  } catch {
    return null
  }
}

export default function middleware(request: Request) {
  const expectedUser = process.env.BASIC_AUTH_USER?.trim()
  const expectedPassword = process.env.BASIC_AUTH_PASSWORD?.trim()

  // Skip gate when credentials are not configured (local dev without env).
  if (!expectedUser || !expectedPassword) {
    return next()
  }

  const credentials = request.headers.get('authorization')
  if (!credentials) return unauthorized()

  const parsed = decodeBasicAuth(credentials)
  if (!parsed) return unauthorized()

  if (parsed.user === expectedUser && parsed.password === expectedPassword) {
    return next()
  }

  return unauthorized()
}
