# Running Unki GeoTech

## Why GitHub Pages cannot host this

GitHub Pages serves **static files only**. It runs no server process and hosts
no database.

Two of the three pieces here are static and would sit on Pages happily — the
field PWA and the dashboard are both just HTML, CSS and JavaScript after a
build. The third is not: the API is a Node process that talks to PostgreSQL,
signs tokens, enforces role boundaries and writes the audit trail. None of that
can run on static hosting.

And the parts that can't move to the browser are exactly the parts that must
not. Authorisation checked in the browser is authorisation an attacker controls;
an audit trail the client can write is not an audit trail. So the API needs a
host that runs Node, and a PostgreSQL database beside it.

You *can* still put the two front ends on Pages if you want to, with the API
hosted elsewhere — see **Split hosting** below.

---

## 1. Running it locally

Everything below assumes Node 20+ and Git.

```bash
git clone https://github.com/webcraftingtwo/GeoTech.git
cd GeoTech
git checkout claude/unki-geotech-field-app-am5uta
npm install
```

### The database

With Docker:

```bash
npm run db:up          # postgres + minio
```

Without Docker, any local PostgreSQL 16 works. Create a database and point at
it. On Debian/Ubuntu, for example:

```bash
sudo -u postgres createuser geotech --createdb
sudo -u postgres createdb geotech -O geotech
```

### Configure and start

```bash
cp apps/api/.env.example apps/api/.env
```

Edit `apps/api/.env` — at minimum `DATABASE_URL` and a real `JWT_SECRET`
(`openssl rand -base64 32` gives you one). Then:

```bash
npm run db:push        # create the tables
npm run db:seed        # reference data + four demo users
npm run db:seed:demo   # optional: a shift of demo geology
```

Three terminals:

```bash
npm run dev:api        # http://localhost:4000
npm run dev:field      # http://localhost:5173   technician app
npm run dev:dashboard  # http://localhost:5174   geologist dashboard
```

Sign in with `T001` (technician), `G001` (geologist), `S001` (senior
geologist) or `A001` (administrator), password `ChangeMe123`.

### Trying it on a phone

The field app is the point, and it is worth seeing on a real device. Both dev
servers accept `--host`:

```bash
npm run dev:field -- --host 0.0.0.0
```

Then open `http://<your-computer-ip>:5173` on a phone on the same network. Note
that **service workers need HTTPS or localhost**, so offline mode will not
engage over a plain-IP LAN address. To test offline properly, either use a
tunnel that terminates TLS (`cloudflared tunnel --url http://localhost:5173`) or
build and preview locally as below.

### Verifying offline behaviour

The dev server has no service worker, so offline reloads fail there for reasons
that have nothing to do with the app. Test against the built bundle:

```bash
npm run build -w @geotech/field
npm run preview -w @geotech/field     # http://localhost:4173
```

In the browser: DevTools → Network → Offline. Capture records, reload the page,
confirm nothing is lost, go back online and watch the queue drain.

---

## 2. Deploying it properly

The shape is the same wherever you put it: **one Node process, one PostgreSQL
database, object storage for photographs, and two static bundles.**

### Option A — one small server (simplest, and enough for a mine)

A single VM or container host running:

- the API as a systemd service or container (`npm run build -w @geotech/api`,
  then `node apps/api/dist/server.js`)
- PostgreSQL on the same host or a managed instance
- nginx or Caddy serving `apps/field/dist` and `apps/dashboard/dist`, and
  proxying `/api` to the API

Serving the front ends from the same origin as the API is the arrangement to
prefer: no CORS, no cross-origin cookie questions, and `VITE_API_URL` can stay
unset. A Caddyfile is about six lines:

```
geotech.example.com {
    handle /api/* {
        reverse_proxy localhost:4000
    }
    handle {
        root * /srv/geotech/field
        try_files {path} /index.html
        file_server
    }
}
```

TLS is not optional. The service worker needs it, and so does everything else.

### Option B — managed platform

The API runs anywhere that runs a Node process with a Postgres attached —
Railway, Render, Fly.io, an Azure App Service, a container on ECS. Point
`DATABASE_URL` at the managed database, set `JWT_SECRET` and `CORS_ORIGINS`,
run `npx prisma migrate deploy` on release.

### Option C — split hosting (this is where Pages fits)

If you specifically want the front ends on GitHub Pages, Netlify or similar:

1. Host the API somewhere that runs Node, with a Postgres beside it.
2. Build each front end pointing at it:
   ```bash
   VITE_API_URL="https://geotech-api.example.com" npm run build -w @geotech/field
   ```
3. Set `CORS_ORIGINS="https://youruser.github.io"` on the API.
4. Publish `apps/field/dist` and `apps/dashboard/dist`.

This works, but it buys you two origins to keep in step and a CORS
configuration to get wrong. Option A is less to hold.

### For a mine, realistically

This handles geological data about a working mine. It belongs on infrastructure
the mine controls — an internal server behind the corporate network, with the
database backed up on the mine's own schedule — not on a public host. The
architecture assumes nothing about the internet beyond "devices reach the API
when they surface".

---

## 3. Production checklist

Before this handles a single real observation:

- [ ] `JWT_SECRET` set to a strong per-environment value. The API refuses to
      start in production if it is still the example string.
- [ ] `DATABASE_URL` pointing at a database with **backups configured**. Every
      geological observation ever captured lives there.
- [ ] `CORS_ORIGINS` set to the exact front-end origins, not `*`.
- [ ] TLS terminated in front of the API and both front ends.
- [ ] `SESSION_IDLE_TIMEOUT_MINUTES` and `OFFLINE_GRANT_HOURS` set to the mine's
      IT policy rather than the defaults.
- [ ] Demo users deleted or deactivated; real users created through the admin
      panel with a forced password change.
- [ ] Object storage configured for photographs (`STORAGE_DRIVER=s3` and the
      MinIO/S3 credentials) rather than the local disk driver.
- [ ] **The placeholder geological terminology replaced** with the
      mine-approved lists, conventions and validation rules through the
      administration panel. The seeded values are neutral development data and
      are not Unki codes.
- [ ] `prisma migrate deploy` in the release process rather than `db push`.
- [ ] Usability testing done with actual geological technicians on real
      underground workflows — see `docs/TESTING.md`.
