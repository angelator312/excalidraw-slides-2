# Excalidraw Slides

A collaborative presentation plugin and server for Excalidraw.  
**One scene = one slide.** Multiple presentations stored in MongoDB.  
Real-time collaboration via WebSocket (Socket.io), role-based access control, versioning (N=50) + named snapshots, PNG export, and a Presenter View with laser pointer.

---

## Features

| Feature | Details |
|---|---|
| 🖼 **Multi-presentation workspace** | Create, manage and switch between any number of presentations |
| 👥 **Real-time collaboration** | Live cursor sharing and scene diffs via Socket.io |
| 🔐 **Authentication** | Owner-generated one-time invite links; anonymous guest view |
| 👁 **Role-based visibility** | `public`, `private`, `team-only` with explicit editor lists |
| 🏢 **Teams (on-demand)** | Create a team and add members by username |
| 🔗 **Share links** | Role-based (view/edit) tokens with optional expiry |
| 📜 **Versioning** | Bounded auto-history (N=50) + unlimited named snapshots (user-deletable) |
| 📤 **Export** | PNG per-slide; Notes as Markdown/TXT; Thumbnails as separate files |
| 🎤 **Presenter View** | Speaker notes, timer, thumbnail strip, keyboard & touch nav |
| 🔴 **Laser pointer** | Visible to presenter AND all viewers |

---

## Quick Start (Development)

### Prerequisites
- Node.js 20+
- MongoDB 7 (local or Atlas)

### 1. Client

```bash
npm install
npm run dev          # http://localhost:3000
```

### 2. Server

```bash
cd server
cp .env.example .env    # edit JWT_SECRET and MONGO_URI
npm install
npm run dev          # http://localhost:4000
```

### 3. Run tests

```bash
# From repo root
npm test
```

---

## Docker (Production)

```bash
cp server/.env.example .env
# Edit .env: JWT_SECRET, CLIENT_ORIGIN
docker compose up -d
```

This starts MongoDB (port 27017), Redis (port 6379), and the server (port 4000).

Deploy the client build (`npm run build → dist/`) to any static host.

---

## First-Time Setup (Owner Bootstrap)

1. Insert the first owner into MongoDB manually:

```js
// mongosh
use excalidraw-slides
db.users.insertOne({
  username: "admin",
  displayName: "Admin",
  role: "owner",
  createdAt: new Date(),
  lastSeen: new Date(),
})
```

2. Generate a session token for the owner (sign a JWT with your `JWT_SECRET`).

3. Generate invite tokens for new users:

```
POST /api/auth/generate-invite
Authorization: Bearer <owner-jwt>
{ "username": "alice", "displayName": "Alice", "expiryHours": 72 }
```

4. Share the token. User accepts at:

```
POST /api/auth/accept
{ "token": "<one-time-token>" }
```

---

## Admin Page — Creating & Managing Users

The easiest way to create new users is through the built-in **Admin UI** at `/admin` (owner only). No manual `mongosh` or `curl` required after the initial bootstrap.

### Step-by-step: Invite a new user

1. Log in as an **owner** account and open `/admin` in your browser.
2. Click **"Create Invite"** and fill in:
   - **Email** (optional — informational only, not validated)
   - **Expiry** — how many days the link is valid (default: 7)
   - **Max uses** — `1` for a personal invite, up to `100` for a team sign-up link
3. Click **Generate**. Copy the invite link shown (it includes the one-time token).
4. Send the link to the new user. When they open it they will be prompted to choose a **username** and **display name**.
5. After they accept, their account appears in the **Users** list in the admin panel.

### Revoking an invite

Open the **Invites** tab in the admin panel, find the token and click **Revoke**. Any unused tokens are immediately invalidated.

### Removing or editing a user

Currently only MongoDB direct edits are supported for deleting or changing a user's role:

```js
// Promote a user to owner
db.users.updateOne({ username: "alice" }, { $set: { role: "owner" } })

// Delete a user
db.users.deleteOne({ username: "alice" })
```

---

## API Reference

### Auth
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/generate-invite` | Owner | Generate one-time invite token |
| POST | `/api/auth/accept` | — | Accept invite token → session JWT |
| POST | `/api/auth/anonymous` | — | Create anonymous guest session |
| GET | `/api/auth/me` | Bearer | Get current user |

### Teams
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/teams` | Bearer | Create team (caller = owner) |
| GET | `/api/teams` | Bearer | List your teams |
| POST | `/api/teams/:id/members` | Team owner | Add member by username |
| DELETE | `/api/teams/:id/members/:userId` | Team owner | Remove member |
| GET | `/api/teams/search/users?q=` | Bearer | Search users by username prefix |

### Presentations
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/presentations` | Optional | List accessible presentations |
| POST | `/api/presentations` | Bearer | Create presentation |
| GET | `/api/presentations/:id` | Optional | Get presentation + slides |
| PATCH | `/api/presentations/:id` | Editor | Update title/visibility |
| DELETE | `/api/presentations/:id` | Owner | Delete presentation |
| POST | `/api/presentations/:id/editors` | Owner | Add editor by username |
| DELETE | `/api/presentations/:id/editors/:userId` | Owner | Remove editor |

### Slides
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/presentations/:id/slides` | Editor | Add slide |
| PATCH | `/api/presentations/:id/slides/:slideId` | Editor | Update slide |
| DELETE | `/api/presentations/:id/slides/:slideId` | Editor | Delete slide |

### Versions & Snapshots
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `.../slides/:slideId/versions` | Viewer | List auto-versions + snapshots |
| POST | `.../slides/:slideId/snapshots` | Editor | Save named snapshot |
| POST | `.../versions/:versionId/restore` | Editor | Restore a version |
| DELETE | `.../versions/:versionId` | Editor | Delete snapshot |

### Share Links
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/presentations/:id/share-links` | Owner | List links |
| POST | `/api/presentations/:id/share-links` | Owner | Create link |
| DELETE | `/api/presentations/:id/share-links/:token` | Owner | Revoke link |

---

## Access Control Matrix

| Who | public | private | team-only |
|---|---|---|---|
| Anonymous | View | — | — |
| Authenticated (not listed) | View | — | — |
| Explicit viewer | View | View | — |
| Explicit editor | View+Edit | View+Edit | — |
| Team member | View | — | View+Edit |
| Owner | View+Edit | View+Edit | View+Edit |
| Edit share link | View+Edit | View+Edit | View+Edit |
| View share link | View | View | View |

---

## Architecture

```
┌──────────────────────┐  WebSocket (Socket.io)  ┌──────────────┐
│  Preact Client        │ ◄─────────────────────► │ Node Server  │
│  (Vite, port 3000)   │ ◄── REST (proxied) ────► │ (Express,    │
└──────────────────────┘                          │  port 4000)  │
                                                  └──────┬───────┘
                                                         │
                                                ┌────────▼───────┐
                                                │  MongoDB 7     │
                                                └────────────────┘
```

---

## Development Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start Vite dev server (client, port 3000) |
| `npm run build` | Build client for production |
| `npm test` | Run Vitest tests (client + server) |
| `cd server && npm run dev` | Start server with hot-reload (port 4000) |
| `cd server && npm run build` | Compile TypeScript server |
| `docker compose up -d` | Start full stack |

---

## Admin Features

### Invite Tokens

The owner can create invite tokens that allow new users to register. Tokens support:
- **Multi-use** — set `maxUses > 1` for team invites (max 100)
- **Expiry** — configurable in days (default: 7)
- **Email targeting** — optional, informational only
- **Revocation** — owner can revoke unused tokens instantly

```
# Create an invite token
POST /api/admin/invite
Authorization: Bearer <owner-token>
{ "email": "alice@example.com", "expiresInDays": 7, "maxUses": 1 }
→ { token, link, expiresAt, maxUses }

# Revoke a token
POST /api/admin/invite/:token/revoke
Authorization: Bearer <owner-token>

# Accept an invite and create a user account
POST /api/admin/invite/accept
{ "token": "...", "username": "alice", "displayName": "Alice" }
→ { sessionToken, user }

# List all invite tokens
GET /api/admin/invite
Authorization: Bearer <owner-token>
```

### Impersonation

Allows an owner to temporarily act as another user for debugging or support. **Disabled by default in production** — requires `ALLOW_IMPERSONATION=true` in environment.

Every impersonation creates an **audit record** in the `ImpersonationAudit` collection.

```
# Impersonate a user (returns ephemeral 1-hour JWT)
POST /api/admin/impersonate/:userId
Authorization: Bearer <owner-token>
{ "reason": "debugging support ticket #123" }
→ { sessionToken, expiresIn: "1h", targetUser }

# View audit log
GET /api/admin/audit?page=1&limit=50
Authorization: Bearer <owner-token>
```

The ephemeral JWT contains an `impersonatedBy` claim identifying the admin. Impersonation tokens:
- Expire in **1 hour**
- Cannot be used for further impersonation
- Do NOT update the target user's `lastSeen` timestamp

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ALLOW_IMPERSONATION` | `false` | Enable admin impersonation endpoint |
| `SITE_ORIGIN` | `http://localhost:3000` | Used to construct invite links |
| `JWT_SECRET` | *(must be set)* | Secret for signing JWTs |

---

## Excalidraw Viewer

Each slide is stored as an Excalidraw scene JSON (`elements` + `appState`). The client
includes a **read-only viewer** component that lazy-loads `@excalidraw/excalidraw` on demand.

### Libraries

Per-presentation Excalidraw libraries (`.excalidrawlib` JSON files) can be uploaded and applied to the viewer. Libraries are stored in MongoDB and validated against the Excalidraw library schema.

```
# Upload a library
POST /api/presentations/:id/libraries
Authorization: Bearer <token>
{ "name": "My shapes", "libraryData": { "type": "excalidrawlib", "version": 2, "library": [...] } }

# List libraries (metadata only)
GET /api/presentations/:id/libraries

# Fetch full library data
GET /api/presentations/:id/libraries/:libraryId

# Delete a library
DELETE /api/presentations/:id/libraries/:libraryId
```

Library size limit: **2 MB** per upload.

### Client Components

- **`ExcalidrawViewer`** — lazy-loads Excalidraw and renders a slide in `viewModeEnabled` (read-only)
- **`LibraryUploader`** — upload `.excalidrawlib` / `.json` files and list existing libraries

### Vite / Preact Compatibility

`vite.config.ts` aliases `react` and `react-dom` to `preact/compat` so `@excalidraw/excalidraw` works within the Preact app without bundling React separately.
