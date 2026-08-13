# Postman Clone

Monorepo-style workspace with a NestJS backend and a React frontend. Package manager: **yarn**.

```
backend/    NestJS + TypeORM + PostgreSQL
frontend/   React + Redux Toolkit + TypeScript + Tailwind CSS (Vite)
```

## Prerequisites

- Node.js 20+
- Yarn 1.x
- PostgreSQL 18 running locally with a `postman_clone` database

Create the database if it does not exist:

```bash
psql -U postgres -c "CREATE DATABASE postman_clone"
```

## Quick start — `dev.sh`

`dev.sh` installs dependencies in both repos, starts them, and supervises them.

```bash
./dev.sh                  # yarn install everywhere, start both, print status
./dev.sh status           # status table
./dev.sh restart backend  # restart one service
./dev.sh stop             # stop everything
./dev.sh logs frontend -f # tail a log
```

```
SERVICE    STATUS     PID      PORT   URL                                UPTIME
backend    running    25636    3000   http://localhost:3000/api/tasks    5s
frontend   running    6344     5173   http://localhost:5173              2s
```

Every command takes an optional service name (`backend` or `frontend`); omit it to act
on both. Liveness is determined by *what is actually listening on the port*, not by a
pidfile, so a stale pidfile or an orphaned child never produces a wrong answer. Stopping
kills the whole process tree — `yarn dev` spawns node, and killing only the parent would
leave the real server holding the port.

Logs and pidfiles live in the gitignored `.dev/` directory.

Run the repos by hand instead if you prefer:

## Backend

```bash
cd backend
cp .env.example .env   # then set DB_PASSWORD
yarn install
yarn start:dev         # http://localhost:3000/api
```

`DB_SYNCHRONIZE=true` lets TypeORM create the `tasks` table automatically. Switch it off
and move to migrations before deploying anywhere real.

### Task API

All routes are under the `/api` prefix.

| Method   | Route         | Body                            | Response |
| -------- | ------------- | ------------------------------- | -------- |
| `GET`    | `/api/tasks`     | —                               | `Task[]` |
| `POST`   | `/api/tasks`     | `{ title, description?, status? }` | `Task` (201) |
| `GET`    | `/api/tasks/:id` | —                               | `Task` |
| `PATCH`  | `/api/tasks/:id` | partial `{ title, description, status }` | `Task` |
| `DELETE` | `/api/tasks/:id` | —                               | 204 |

`status` is one of `TODO`, `IN_PROGRESS`, `DONE`.

Request bodies are validated with a global `ValidationPipe` using `whitelist` and
`forbidNonWhitelisted`, so unknown fields are rejected with a 400.

## Frontend

```bash
cd frontend
yarn install
yarn dev               # http://localhost:5173
```

Vite proxies `/api` to `http://localhost:3000`, so no CORS handling or base URL config is
needed in development. Server state is handled by RTK Query (`src/features/tasks/tasksApi.ts`),
which owns caching and refetching; add plain slices to `src/app/store.ts` for local UI state.
