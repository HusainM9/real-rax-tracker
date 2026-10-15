export function methodNotAllowed(): Response {
  return new Response('Method Not Allowed', { status: 405 })
}
