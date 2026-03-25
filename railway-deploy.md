# Railway Deployment

Project: **dazzling-warth** on [Railway](https://railway.app)

## How it works

Pushes to `main` on GitHub automatically trigger a Railway redeploy. Railway uses Nixpacks to detect Python, install dependencies from `requirements.txt`, and start the app with `gunicorn app:app`.

## Persistent storage (important)

SQLite writes to `family.db` on disk. Without a persistent volume, the database resets on every redeploy.

**To set up a volume in Railway:**
1. Open your service in the Railway dashboard
2. Go to **Settings → Volumes**
3. Add a volume mounted at `/app` (or wherever Railway places the app root)

Until a volume is attached, data will be lost on each deploy. Once attached, the DB persists across deploys.

## Environment variables

No required env vars — the app auto-generates a secret key on first run and stores it in the database.

Optional override:
| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | set by Railway | Port gunicorn binds to (Railway sets this automatically) |

## First run

After deploying, visit the app URL and set your password. To pre-load family data, run the seed script once via Railway's shell:

```bash
python seed.py
```

(Railway dashboard → your service → **Shell** tab)

## Files added for Railway

| File | Purpose |
|------|---------|
| `Procfile` | Tells Railway to start with `gunicorn app:app` |
| `railway.toml` | Build/deploy config: Nixpacks builder, health check on `/login` |
| `requirements.txt` | Added `gunicorn` |
