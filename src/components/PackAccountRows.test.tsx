// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { PackAccountRows } from './PackAccountRows'

it('keeps an account editor open when its username becomes non-empty', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div'), root = createRoot(host)
  const render = (username: string) => <PackAccountRows player="Player" accounts={[{ id: 'a', name: 'New account', username, rating: 0, opensPacks: true }]} now={new Date()} weeklyOnly={false} showOpenings busy={false} onAdd={vi.fn()} onUpdate={vi.fn()} onImport={vi.fn()} onRemove={vi.fn()} onIgnoreMissing={vi.fn()} />
  try {
    await act(async () => root.render(render('')))
    const editor = host.querySelector<HTMLDetailsElement>('details')!
    editor.open = true
    await act(async () => root.render(render('g')))
    expect(editor.open).toBe(true)
  } finally { await act(async () => root.unmount()) }
})
