import { useState } from 'react'
import ConfirmDialog from './ConfirmDialog'
import { ThemedSelect } from './ThemedSelect'
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
      <ThemedSelect
        className="themed-select-compact"
        ariaLabel={`Rarity for ${card.name || 'card'}`}
        value={currentRarity}
        onChange={(nextRarity) => {
          if (nextRarity === currentRarity) return
          setPendingRarity(nextRarity)
        }}
        options={[
          { value: '', label: 'Unknown' },
          ...options.map((option) => ({ value: option, label: option })),
        ]}
      />

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
