# Preview deployment lockdown

Preview URLs are created for every pull request and branch deploy. Lock them down so random preview links are not an open copy of the app.

## Steps (Vercel dashboard)

1. Open [Vercel → real-rax-tracker → Settings → Deployment Protection](https://vercel.com/sniperhusain-9147s-projects/real-rax-tracker/settings/deployment-protection)
2. Enable protection for **Preview** deployments
3. Choose one of:
   - **Vercel Authentication** (team members only) — recommended if you use a Vercel team
   - **Password Protection** (Vercel Pro) — separate preview password
4. Save settings

Production is already gated by the in-app login page and [`middleware.ts`](../middleware.ts). Preview protection adds a second layer so old PR URLs are not publicly reachable.

## Verify

1. Open a preview deployment URL in an incognito window
2. Confirm you are prompted for Vercel protection **before** the app loads
3. After passing Vercel protection, you should still hit `/login` for the app password

## Note

This cannot be enabled from code — it is a one-time dashboard setting per project.
