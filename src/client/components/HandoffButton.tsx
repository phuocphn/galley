import { useState } from 'react'
import type { Handoff } from '../../shared/types.js'

interface HandoffButtonProps {
  load: () => Promise<Handoff>
}

/**
 * Copies the instruction the reviewer pastes into their agent.
 *
 * The text is generated on the server, not here — it's the actual contract with
 * the agent, so it lives where the tests can reach it.
 */
export function HandoffButton({ load }: HandoffButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  async function copy(): Promise<void> {
    try {
      const handoff = await load()
      await navigator.clipboard.writeText(handoff.instruction)
      setState('copied')
    } catch {
      setState('failed')
    }
    setTimeout(() => setState('idle'), 2000)
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title="Copy an instruction for your coding agent"
      className="shrink-0 rounded-md border border-[#1f883d] bg-[#1f883d] px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-[#1a7f37]"
    >
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy handoff'}
    </button>
  )
}
