import { listAdminUsers } from '../../lib/adminEventStore'
import { requireAdminSession } from './_helpers'

export const config = {
  runtime: 'edge',
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const adminDenied = await requireAdminSession(request)
  if (adminDenied) return adminDenied

  const result = await listAdminUsers()
  return Response.json(result)
}
