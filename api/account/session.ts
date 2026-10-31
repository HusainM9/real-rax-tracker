import { withErrorLogging } from '../../lib/withErrorLogging.js'
import { methodNotAllowed } from '../../lib/httpResponses.js'

import {
  getAccountCookieName,
  verifyAccountSessionToken,
} from '../../lib/accountAuth.js'
import { getAccountEnvStatus } from '../../lib/accountEnvStatus.js'
import { authConfigured, readCookie } from '../../lib/authCookie.js'
import { accountSessionIsRevoked } from '../../lib/accountCredentialsStore.js'
import { requireAppSession } from '../admin/_helpers.js'

export const config = {
  runtime: 'edge',
}

async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return methodNotAllowed()
  }

  const denied = await requireAppSession(request)
  if (denied) return denied

  const envStatus = getAccountEnvStatus()

  if (!authConfigured() && process.env.NODE_ENV === 'development') {
    const token = readCookie(request, getAccountCookieName())
    const result = await verifyAccountSessionToken(token)
    if (
      result.ok &&
      !(await accountSessionIsRevoked(result.username, result.credentialsUpdatedAt))
    ) {
      return Response.json({
        ok: true,
        username: result.username,
        devBypass: true,
        ...envStatus,
      })
    }
    return Response.json({
      ok: false,
      username: null,
      devBypass: true,
      ...envStatus,
    })
  }

  const token = readCookie(request, getAccountCookieName())
  const result = await verifyAccountSessionToken(token)
  if (
    !result.ok ||
    (await accountSessionIsRevoked(result.username, result.credentialsUpdatedAt))
  ) {
    return Response.json({ ok: false, username: null, ...envStatus })
  }

  return Response.json({ ok: true, username: result.username, ...envStatus })
}

export default withErrorLogging('/api/account/session', handler)
