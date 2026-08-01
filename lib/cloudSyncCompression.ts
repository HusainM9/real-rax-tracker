function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function assertWebCompression(): void {
  if (
    typeof CompressionStream === 'undefined' ||
    typeof DecompressionStream === 'undefined' ||
    typeof Blob === 'undefined' ||
    typeof Blob.prototype.stream !== 'function'
  ) {
    throw new Error('Gzip compression is unavailable in this runtime.')
  }
}

async function gzipBytes(input: Uint8Array): Promise<Uint8Array> {
  assertWebCompression()
  const stream = new Blob([input as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function gunzipBytes(input: Uint8Array): Promise<Uint8Array> {
  assertWebCompression()
  const stream = new Blob([input as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function gzipJsonToBytes(data: unknown): Promise<Uint8Array> {
  const json = JSON.stringify(data)
  return gzipBytes(new TextEncoder().encode(json))
}

export async function gunzipBytesToJson(bytes: Uint8Array): Promise<unknown> {
  const jsonBytes = await gunzipBytes(bytes)
  return JSON.parse(new TextDecoder().decode(jsonBytes))
}

export async function gzipJsonToBase64(data: unknown): Promise<string> {
  return bytesToBase64(await gzipJsonToBytes(data))
}

export async function gunzipBase64ToJson(base64: string): Promise<unknown> {
  return gunzipBytesToJson(base64ToBytes(base64))
}

/**
 * Parse a JSON request body, supporting gzip-compressed bodies (binary) so large
 * account sync PUTs stay under Vercel's ~4.5MB function payload limit.
 *
 * Prefer `X-Rax-Content-Encoding: gzip` (set by the client). Also accept
 * `Content-Encoding: gzip` for compatibility.
 */
export async function readRequestJson(request: Request): Promise<unknown> {
  const encoding =
    request.headers.get('x-rax-content-encoding')?.toLowerCase().trim() ||
    request.headers.get('content-encoding')?.toLowerCase().trim()
  if (encoding === 'gzip') {
    return gunzipBytesToJson(new Uint8Array(await request.arrayBuffer()))
  }
  return request.json()
}

export function encodedProfileByteLength(base64: string): number {
  return base64ToBytes(base64).length
}

export type StoredProfilePayload = {
  data?: unknown
  dataBlob?: string
  dataEncoding?: 'gzip-base64'
}

export async function decodeStoredProfilePayload(stored: StoredProfilePayload): Promise<unknown> {
  if (stored.dataEncoding === 'gzip-base64' && typeof stored.dataBlob === 'string') {
    return gunzipBase64ToJson(stored.dataBlob)
  }
  return stored.data
}

export async function encodeStoredProfilePayload(data: unknown): Promise<{
  dataBlob: string
  dataEncoding: 'gzip-base64'
}> {
  return {
    dataBlob: await gzipJsonToBase64(data),
    dataEncoding: 'gzip-base64',
  }
}
