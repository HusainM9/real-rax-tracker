import type { PlannedPass } from '../types/rax'
import { recommendationAdjustmentFromPass, type RecommendationPassAdjustment } from './passRecommendation'

/** Changes only the analysis assumptions, never the source Plan or collection. */
export function setPlanUpgradeAssumed(adjustments: RecommendationPassAdjustment[], pass: PlannedPass, assumed: boolean): RecommendationPassAdjustment[] {
  if (!pass.externalKey?.trim()) return adjustments
  const remaining = adjustments.filter((adjustment) => adjustment.externalKey !== pass.externalKey)
  return assumed ? [...remaining, recommendationAdjustmentFromPass(pass, 'assume-iconic-1')] : remaining
}

export function assumeAllPlanUpgrades(adjustments: RecommendationPassAdjustment[], passes: PlannedPass[]): RecommendationPassAdjustment[] {
  return passes.reduce((current, pass) => setPlanUpgradeAssumed(current, pass, true), adjustments)
}
