import {
  LOCAL_DEV_ACCOUNT_USERNAME,
  isGordonAccountUsername,
  isGordonToolsDevelopment,
} from '../../lib/gordonAccess'
import { getAccountSessionUsername, requireAppSession } from '../admin/_helpers'

export async function requireGordonSession(
  request: Request,
): Promise<{ username: string } | Response> {
  const appDenied = await requireAppSession(request)
  if (appDenied) return appDenied

  const username = await getAccountSessionUsername(request)
  if (isGordonAccountUsername(username)) {
    return { username: username! }
  }

  // Localhost “continue with local browser data” has no account cookie.
  if (isGordonToolsDevelopment() && !username) {
    return { username: LOCAL_DEV_ACCOUNT_USERNAME }
  }

  if (username) {
    return Response.json({ error: 'Not available for this account.' }, { status: 403 })
  }
  return Response.json({ error: 'Account login required' }, { status: 401 })
}
