# Site password policy

The live app uses one shared site password (`BASIC_AUTH_PASSWORD` in Vercel). Use this as a checklist when sharing access with friends.

## Password requirements

- Generate a **long random string** (password manager or `openssl rand -base64 32`).
- Do **not** reuse a personal password you use elsewhere.
- Store the live password only in **Vercel env vars** — never commit it to git or paste it in Discord publicly.

## Who gets access

Keep a private list of who has the password (name + date shared). Remove people from the list when they no longer need access.

Share the password through a **private channel** (DM, in-person, password manager share link) — not in a public server channel.

## Rotation

Rotate `BASIC_AUTH_PASSWORD` in Vercel when:

- The password may have leaked or was posted somewhere public
- Someone who had access should no longer have it
- Routinely every few months for a small friend group

After rotating:

1. Vercel → Project → Settings → Environment Variables → edit `BASIC_AUTH_PASSWORD`
2. Redeploy production (or wait for the next push to `main`)
3. Send the new password privately to current users
4. Old sessions expire within 7 days, or users can sign out and sign in again

Optional: set `AUTH_SESSION_SECRET` to a separate random string so cookie signing does not reuse the login password.

## Vercel / GitHub access

Anyone with Vercel project access can read env vars including the site password. Limit dashboard access to people who need to deploy.
