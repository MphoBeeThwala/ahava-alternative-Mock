# Run PostgreSQL with Docker (local development)

## 1. Start PostgreSQL

From the project root:

```powershell
docker compose up -d
```

Check it’s running:

```powershell
docker compose ps
```

## 2. Point the backend at it

In **`apps/backend/.env`** set (or update):

```env
DATABASE_URL="postgresql://ahava:ahava_dev@localhost:5432/ahava"
```

If you use IPv6 or `localhost` doesn’t resolve, try:

```env
DATABASE_URL="postgresql://ahava:ahava_dev@127.0.0.1:5432/ahava"
```

## 3. Run migrations

```powershell
cd apps/backend
npx prisma migrate deploy
```

## 4. (Optional) Seed data

```powershell
pnpm run seed:mock-patients
# or
pnpm run seed:synthea
```

## Stop the database

```powershell
docker compose down
```

Data is kept in a Docker volume. To remove it too:

```powershell
docker compose down -v
```
