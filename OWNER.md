# Self-Hosting Guide

This guide covers everything you need to run **Excalidraw Slides** on your own server.

---

## Architecture

```
┌───────────────────────┐   HTTP/WebSocket   ┌─────────────────────┐
│  Preact + Vite client │ ◄────────────────► │  Node.js + Express  │
│  (static files)       │                    │  (port 4000)        │
└───────────────────────┘                    └──────────┬──────────┘
                                                        │
                                             ┌──────────▼──────────┐
                                             │     MongoDB 7        │
                                             └─────────────────────┘
```

- **Client** — Preact SPA, built with Vite, served as static files
- **Server** — Express + Socket.io, connects to MongoDB
- Both can run on the same VM or be split across hosts

---

## Quick Start with Docker (Recommended)

### 1. Clone & configure

```bash
git clone https://github.com/your-org/excalidraw-slides
cd excalidraw-slides

cp server/.env.example server/.env
```

Edit `server/.env`:

```env
# Required
JWT_SECRET=<generate a long random string, e.g. openssl rand -hex 32>
MONGO_URI=mongodb://mongo:27017/excalidraw-slides

# Optional
SITE_ORIGIN=https://slides.example.com   # for invite link generation
PORT=4000
ALLOW_IMPERSONATION=false
```

### 2. Build and start

```bash
docker compose up -d --build
```

This starts:
- `mongo` — MongoDB 7 on port 27017 (not exposed externally)
- `server` — Node.js API + WebSocket on port 4000
- MongoDB data is persisted in a named Docker volume

### 3. Build and serve the client

The client is a static SPA. Build it once:

```bash
npm install
VITE_API_URL=https://slides.example.com npm run build
```

Serve the `dist/` directory with nginx, Caddy, or any static file host.  
Configure your web server to:
- Proxy `/api/*` and `/socket.io/*` to `http://localhost:4000`
- Serve all other paths from `dist/index.html` (SPA routing)

**Example nginx snippet:**

```nginx
server {
  listen 443 ssl;
  server_name slides.example.com;

  root /var/www/excalidraw-slides/dist;
  index index.html;

  # API + WebSocket proxy
  location ~ ^/(api|socket.io)/ {
    proxy_pass http://localhost:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }

  # SPA fallback
  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

---

## Manual Setup (No Docker)

### Prerequisites

- Node.js 20+
- MongoDB 7 (local or Atlas)

### Server

```bash
cd server
cp .env.example .env   # set JWT_SECRET and MONGO_URI
npm install
npm run build          # compile TypeScript → dist/
node dist/index.js     # production
# or for development:
npm run dev
```

### Client

```bash
npm install
npm run dev            # http://localhost:3000 (dev server with HMR)
# or for production:
npm run build          # outputs to dist/
```

---

## First-Time Owner Bootstrap

After first launch the database is empty. You must insert the first **owner** account directly into MongoDB.

### Option A — mongosh

```js
// In your terminal:
mongosh "mongodb://localhost:27017/excalidraw-slides"

db.users.insertOne({
  username: "admin",
  displayName: "Admin",
  role: "owner",
  createdAt: new Date(),
  lastSeen: new Date(),
})
```

### Option B — Docker exec

```bash
docker exec -it excalidraw-slides-mongo-1 \
  mongosh excalidraw-slides --eval \
  'db.users.insertOne({ username:"admin", displayName:"Admin", role:"owner", createdAt:new Date(), lastSeen:new Date() })'
```

### Generate the owner's first session token

The easiest way is to use the server's own environment. From the `server/` directory:

```bash
cd server
node -e "
const jwt = require('jsonwebtoken');
const secret = process.env.JWT_SECRET;
if (!secret) { console.error('Set JWT_SECRET env var'); process.exit(1); }
// Replace with the actual _id you see in mongosh after insertOne()
const userId = '<paste-ObjectId-here>';
const token = jwt.sign({ sub: userId, role: 'owner' }, secret, { expiresIn: '365d' });
console.log('\\nSession token:\\n' + token + '\\n');
" JWT_SECRET=<your-jwt-secret>
```

> **Tip:** The `jsonwebtoken` package is already installed as a server dependency — no extra `npm install` needed.

In the browser:
1. Open the app
2. Open the browser console (F12 → Console) and run:
   ```js
   localStorage.setItem('sessionToken', '<paste token here>');
   location.reload();
   ```

You are now logged in as the owner.

---

## Creating & Managing Users (Admin Panel)

Once logged in as an owner, you manage all user creation from the **Admin panel** at `/admin`.

### Creating an invite link (step-by-step)

1. Click **Admin** in the top navigation bar (only visible to owners)
2. Go to the **🔗 Invite Tokens** tab
3. Fill in:
   - **Email** (optional — informational only)
   - **Expires in** — how many days the link stays valid
   - **Max uses** — `1` for a personal invite, higher for a team sign-up link
4. Click **Generate invite link**
5. Copy the link and send it to the new user

### What happens when a user follows the link

1. They land on `/invite/accept?token=<token>`
2. The page switches to the **Sign up** tab automatically and skips to account setup
3. They choose a **username** and **display name**
4. Account is created and they are shown their **auth token** — a long string starting with `eyJ`

> ⚠ **Important:** Users must copy and save their auth token before clicking "Enter app". This token is not stored by the app and cannot be recovered.

### How users sign in after initial sign-up

On the login screen, use the **Sign in** tab and paste the auth token that was shown during sign-up. The app verifies the token and starts a new 30-day session.

### Managing user roles

In the **👥 Users** tab, every registered user has a role dropdown. Owners can change any user's role between `user` and `owner`. A user cannot change their own role.

> **Note:** Changing a user's role does not invalidate their existing auth token. Their next sign-in will use the new role.

### Revoking an invite

In the **Invite Tokens** tab, find the token and click **Revoke**. Unused invites are instantly invalidated.

### Viewing all users

Click the **👥 Users** tab to see all registered accounts, their roles, and join dates.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `JWT_SECRET` | **Yes** | `change-me-...` | Secret for signing session JWTs. Must be long and random in production. |
| `MONGO_URI` | **Yes** | `mongodb://localhost:27017/excalidraw-slides` | MongoDB connection string |
| `PORT` | No | `4000` | Server port |
| `SITE_ORIGIN` | No | `http://localhost:3000` | Public URL — used to construct invite links |
| `ALLOW_IMPERSONATION` | No | `false` | Set to `true` to enable admin user impersonation (for debugging) |
| `CLIENT_ORIGIN` | No | Same as `SITE_ORIGIN` | CORS origin for the client |

---

## Upgrading

1. Pull the latest code
2. Rebuild both server and client:
   ```bash
   cd server && npm install && npm run build
   cd .. && npm install && npm run build
   ```
3. Restart the server process (or `docker compose up -d --build`)

MongoDB schema changes (new fields) use sensible defaults and are backward-compatible.

---

## Backup

All data lives in MongoDB. Back up the `excalidraw-slides` database:

```bash
# Dump
mongodump --db excalidraw-slides --out /backups/$(date +%Y%m%d)

# Restore
mongorestore --db excalidraw-slides /backups/20240101/excalidraw-slides
```

With Docker Compose, the MongoDB data is in the `mongo_data` named volume:

```bash
docker run --rm \
  -v excalidraw-slides_mongo_data:/data/db \
  -v $(pwd)/backups:/backups \
  mongo:7 mongodump --db excalidraw-slides --out /backups/$(date +%Y%m%d)
```

---

## Security Checklist

- [ ] `JWT_SECRET` is a random string of at least 32 bytes — **never** the default
- [ ] MongoDB is not exposed to the internet (bind to `127.0.0.1` or use Docker networking)
- [ ] TLS/HTTPS is terminated at your reverse proxy (nginx/Caddy)
- [ ] `ALLOW_IMPERSONATION` is `false` unless actively needed
- [ ] Invite tokens are scoped to minimal `maxUses` and short `expiresInDays`
- [ ] Run `npm audit` and keep dependencies up to date
