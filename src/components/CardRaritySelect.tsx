import { useState } from 'react'
import ConfirmDialog from './ConfirmDialog'
import {
  formatCardRarityChangeMessage,
  rarityOptionsForCard,
} from '../lib/cardRarity'
import type { PlayerCard } from '../types/rax'

type CardRaritySelectProps = {
  card: PlayerCard
  onConfirmChange: (cardId: string, targetRarity: string) => void
}

export default function CardRaritySelect({ card, onConfirmChange }: CardRaritySelectProps) {
  const [pendingRarity, setPendingRarity] = useState<string | null>(null)
  const currentRarity = card.rarityLabel ?? ''
  const options = rarityOptionsForCard(card)

  const cancelChange = () => setPendingRarity(null)

  const confirmChange = () => {
    if (pendingRarity == null) return
    onConfirmChange(card.id, pendingRarity)
    setPendingRarity(null)
  }

  return (
    <>
      <select
        value={currentRarity}
        aria-label={`Rarity for ${card.name || 'card'}`}
        onChange={(event) => {
          const nextRarity = event.target.value
          if (nextRarity === currentRarity) return
          setPendingRarity(nextRarity)
        }}
      >
        <option value="">Unknown</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>

      {pendingRarity != null ? (
        <ConfirmDialog
          title={formatCardRarityChangeMessage(card.name, card.rarityLabel, pendingRarity)}
          titleId={`card-rarity-change-${card.id}`}
          confirmLabel="Change rarity"
          onConfirm={confirmChange}
          onCancel={cancelChange}
        >
          <p>
            This permanently updates the card&apos;s rarity and recalculates all earnings rows for
            OTD multipliers. The new rarity is saved to your account and with JSON export.
          </p>
        </ConfirmDialog>
      ) : null}
    </>
  )
}
