# Daily feature data discovery

## Today's games and boosters

The existing earnings reconstruction can look up a Real username, fetch its complete pass collection and retrieve a sport's games for a day. These are account-public data fetched through the server's configured Real session; the selected user does not need to supply a Real login. Active pass copies include an optional `boostInfo.isCardBoosted` flag and may include `boosterCardInfo`. This describes a booster attached to a pass, not available inventory.

The existing Real `playstoday` collection filter is known to omit some active passes. The earnings code therefore starts with the complete collection and intersects it with game data. Before a game starts, a player's team having a scheduled game is evidence of a possible appearance, not proof the player will play. Missing team IDs and golf tournaments require explicit handling; do not silently treat an unmatchable pass as having no game. Preserve separate copies and their boost states, and represent missing booster flags as unknown rather than unboosted.

The home-day endpoint has previously returned incomplete CFB games, so the existing helper also reconstructs games from plays and box-score rows where available. That fallback does not guarantee a complete future slate. Verify each sport and scheduled-game coverage with representative live responses before presenting the feature as complete. Confirm the booster expiration and day boundary separately: the approximately 7 AM Eastern earnings boundary is not proof of the booster's reset time.

Relevant code: `lib/realApi.ts` (`getUserByUsername`, `listPasses`, `getRealHomeDayGames`); `lib/publicDailyEarnings.ts` (`selectActivePlayerPasses`, `selectGamesForOwnedPasses`, `currentRealEarningsDay`).

## Daily pack-open status

No verified public endpoint, open timestamp, coverage rule or reset boundary was found in the repository. The pack tracker currently stores manually logged weekly opens; that is not authoritative daily status. A probe script mentions a candidate `/userpasspacks/...` path and a `packOpens` field but does not establish their response semantics or availability. Avoid inferring that a pack was not opened from missing data.

Next, obtain a sanitized request method, endpoint path and parameter names from a working example, or identify the relevant public Real request through a read-only investigation. Validate an account before and after an actual open, other pack types, pagination, timestamps, reset timezone and inaccessible accounts. Return unknown for unavailable or incomplete data, and limit requests and caching based on observed upstream behavior. Never log credentials or private response data.
