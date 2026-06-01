# Push to private GitHub and connect Vercel Git

Run these commands after installing [GitHub CLI](https://cli.github.com/):

```powershell
gh auth login
gh repo create real-rax-tracker --private --source=. --remote=origin --push
npx vercel git connect
```

If the repo name is taken, pick another name and update the `gh repo create` command.

After connecting Git, every push to `main` triggers a Vercel production deploy.
