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
