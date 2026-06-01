const ONBOARDING_DISMISSED_KEY = 'real-rax-tracker:onboarding-dismissed'

export function isOnboardingDismissed(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

export function dismissOnboarding(): void {
  try {
    localStorage.setItem(ONBOARDING_DISMISSED_KEY, '1')
  } catch {
    // Ignore private-mode failures.
  }
}
