import { methodNotAllowed } from '../../lib/httpResponses'

import {
  getAccountCookieName,
  verifyAccountSessionToken,
} from '../../lib/accountAuth'
import { getAccountEnvStatus } from '../../lib/accountEnvStatus'
import { authConfigured, readCookie } from '../../lib/authCookie'
import { accountSessionIsRevoked } from '../../lib/accountCredentialsStore'
import { requireAppSession } from '../admin/_helpers'

export const config = {
  runtime: 'edge',
}

export default async function handler(request: Request): Promise<Response> {
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
