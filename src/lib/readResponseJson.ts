export async function readResponseJson<T>(response: Response): Promise<T> {
  const text = await response.text()
  if (!text.trim()) {
    if (!response.ok) {
      throw new Error(`Request failed (${response.status}).`)
    }
    return {} as T
  }

  try {
    return JSON.parse(text) as T
  } catch {
    const snippet = text.trim().replace(/\s+/g, ' ').slice(0, 160)
    throw new Error(
      response.ok
        ? `Server returned invalid JSON: ${snippet}`
        : `Request failed (${response.status}): ${snippet}`,
    )
  }
}

export async function readResponseError(response: Response, fallback: string): Promise<string> {
  const text = await response.text()
  if (!text.trim()) {
    return `${fallback} (${response.status}).`
  }

  try {
    const data = JSON.parse(text) as { error?: string }
    if (typeof data.error === 'string' && data.error.trim()) {
      return data.error.trim()
    }
  } catch {
    const snippet = text.trim().replace(/\s+/g, ' ').slice(0, 160)
    return `${fallback} (${response.status}): ${snippet}`
  }

  return `${fallback} (${response.status}).`
}
