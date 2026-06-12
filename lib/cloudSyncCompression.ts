function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'))
  }
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function canUseWebCompression(): boolean {
  return (
    typeof CompressionStream !== 'undefined' &&
    typeof Blob !== 'undefined' &&
    typeof Blob.prototype.stream === 'function'
  )
}

async function gzipBytes(input: Uint8Array): Promise<Uint8Array> {
  if (canUseWebCompression()) {
    const stream = new Blob([input as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  }

  const { gzipSync } = await import('node:zlib')
  return gzipSync(input)
}

async function gunzipBytes(input: Uint8Array): Promise<Uint8Array> {
  if (canUseWebCompression()) {
    const stream = new Blob([input as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  }

  const { gunzipSync } = await import('node:zlib')
  return gunzipSync(input)
}

export async function gzipJsonToBase64(data: unknown): Promise<string> {
  const json = JSON.stringify(data)
  const compressed = await gzipBytes(new TextEncoder().encode(json))
  return bytesToBase64(compressed)
}

export async function gunzipBase64ToJson(base64: string): Promise<unknown> {
  const compressed = base64ToBytes(base64)
  const jsonBytes = await gunzipBytes(compressed)
  return JSON.parse(new TextDecoder().decode(jsonBytes))
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
