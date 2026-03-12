# Banking Tracker API

REST API for a mobile banking SMS transaction tracker. Parses SMS alerts from Indian banks into structured transaction data.

## Tech Stack

| Layer      | Technology                              |
|------------|-----------------------------------------|
| Runtime    | Node.js 20                              |
| Framework  | Express 5                               |
| Language   | TypeScript 5                            |
| ORM        | Prisma 7                                |
| Database   | PostgreSQL via Neon (serverless)        |
| Auth       | Better Auth 1.5 (email/password + JWT)  |
| Validation | Zod 4                                   |
| Logging    | Winston                                 |

---

## Local Setup (without Docker)

### 1. Clone and install

```bash
git clone <repo-url>
cd banking-tracker-api
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Fill in all values in .env (see Environment Variables section below)
```

### 3. Run database migrations

```bash
npx prisma migrate dev
```

### 4. Start the dev server

```bash
npm run dev
```

The server starts at `http://localhost:3000`.

### 5. Verify

```bash
curl http://localhost:3000/health
```

---

## Docker Setup

### Prerequisites
- Docker and Docker Compose installed
- A valid `.env` file with `DATABASE_URL` pointing to your Neon database

### Build and run

```bash
docker-compose up --build
```

### Verify

```bash
curl http://localhost:3000/health
```

To stop:

```bash
docker-compose down
```

---

## Environment Variables

| Variable              | Description                                              | Example                                      |
|-----------------------|----------------------------------------------------------|----------------------------------------------|
| `DATABASE_URL`        | Neon pooled connection string (used at runtime)          | `postgresql://user:pass@ep-xxx.neon.tech/db?sslmode=require` |
| `DATABASE_URL_UNPOOLED` | Neon direct connection string (used for migrations)    | `postgresql://user:pass@ep-xxx-pooler.neon.tech/db?sslmode=require` |
| `BETTER_AUTH_SECRET`  | Random 32+ char secret for signing sessions              | `openssl rand -base64 32`                    |
| `BETTER_AUTH_URL`     | Base URL of this API                                     | `http://localhost:3000`                      |
| `PORT`                | Port the server listens on                               | `3000`                                       |
| `NODE_ENV`            | Runtime environment                                      | `development` / `production`                 |
| `ALLOWED_ORIGINS`     | Comma-separated list of allowed CORS origins             | `http://localhost:8081,https://myapp.com`    |
| `BCRYPT_ROUNDS`       | bcrypt cost factor for password hashing                  | `12`                                         |

---

## API Endpoints

### Auth (Better Auth — no `/api/v1` prefix)

| Method | Path                        | Auth | Description            |
|--------|-----------------------------|------|------------------------|
| POST   | `/api/auth/sign-up/email`   | No   | Register a new user    |
| POST   | `/api/auth/sign-in/email`   | No   | Sign in, returns token |
| POST   | `/api/auth/sign-out`        | Yes  | Invalidate session     |
| GET    | `/api/auth/session`         | Yes  | Get current session    |

Send `Authorization: Bearer <token>` for authenticated requests.

### Profile

| Method | Path                    | Auth | Description                    |
|--------|-------------------------|------|--------------------------------|
| GET    | `/api/v1/auth/me`       | Yes  | Get authenticated user profile |
| PATCH  | `/api/v1/auth/profile`  | Yes  | Update phone and avatar        |

### Banks

| Method | Path                          | Auth | Description                         |
|--------|-------------------------------|------|-------------------------------------|
| GET    | `/api/v1/banks`               | Yes  | List all banks for the user         |
| POST   | `/api/v1/banks`               | Yes  | Create a bank (name, shortCode, smsPattern, color) |
| GET    | `/api/v1/banks/:id/accounts`  | Yes  | List accounts under a specific bank |

### Accounts

| Method | Path                      | Auth | Description                    |
|--------|---------------------------|------|--------------------------------|
| GET    | `/api/v1/accounts`        | Yes  | List all bank accounts         |
| PATCH  | `/api/v1/accounts/:id`    | Yes  | Update account (nickname, type)|

### Transactions

| Method | Path                                 | Auth | Description                            |
|--------|--------------------------------------|------|----------------------------------------|
| GET    | `/api/v1/transactions`               | Yes  | List transactions (paginated)          |
| GET    | `/api/v1/transactions/:id`           | Yes  | Get a single transaction               |
| PATCH  | `/api/v1/transactions/:id`           | Yes  | Update category / description          |
| DELETE | `/api/v1/transactions/:id`           | Yes  | Delete a transaction                   |
| POST   | `/api/v1/transactions/sms/process`   | Yes  | Parse and save a single SMS            |
| POST   | `/api/v1/transactions/sms/batch`     | Yes  | Parse and save a batch of SMS messages |

### Analytics

| Method | Path                            | Auth | Description                              |
|--------|---------------------------------|------|------------------------------------------|
| GET    | `/api/v1/analytics/summary`     | Yes  | Overall totals (income, expenses, balance)|
| GET    | `/api/v1/analytics/daily`       | Yes  | Day-by-day breakdown (`?year=&month=`)   |
| GET    | `/api/v1/analytics/weekly`      | Yes  | Week-by-week breakdown                   |
| GET    | `/api/v1/analytics/monthly`     | Yes  | Month-by-month breakdown                 |
| GET    | `/api/v1/analytics/by-category` | Yes  | Spending grouped by category             |
| GET    | `/api/v1/analytics/by-bank`     | Yes  | Spending grouped by bank                 |
| GET    | `/api/v1/analytics/trends`      | Yes  | Current vs previous period (`?period=`)  |

### Health

| Method | Path      | Auth | Description         |
|--------|-----------|------|---------------------|
| GET    | `/health` | No   | Server health check |

---

## Database Models

| Model         | Description                                              |
|---------------|----------------------------------------------------------|
| `user`        | App user (Better Auth managed)                           |
| `session`     | Active auth sessions (Better Auth managed)               |
| `account`     | OAuth credential store (Better Auth managed)             |
| `verification`| Email verification tokens (Better Auth managed)          |
| `Bank`        | A bank entry linked to a user (e.g. HDFC, SBI)          |
| `BankAccount` | A specific account number under a bank                   |
| `Transaction` | A parsed transaction from an SMS alert                   |
| `SmsLog`      | Raw SMS log with parse status and error tracking         |
