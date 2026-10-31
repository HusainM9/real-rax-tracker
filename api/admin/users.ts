import { withErrorLogging } from '../../lib/withErrorLogging.js'
import { methodNotAllowed } from '../../lib/httpResponses.js'

import { listAdminUsers } from '../../lib/adminEventStore.js'
import { requireAdminSession } from './_helpers.js'

export const config = {
  runtime: 'edge',
}

async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return methodNotAllowed()
  }

  const adminDenied = await requireAdminSession(request)
  if (adminDenied) return adminDenied

  const result = await listAdminUsers()
  return Response.json(result)
}

export default withErrorLogging('/api/admin/users', handler)
