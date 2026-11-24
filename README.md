# Parakh (local workspace)

- `app/`      the Parakh product: API (NestJS), web app (Next.js), shared packages. Git repository.
- `website/`  the Parakh landing page and public certificate check. Static Next.js project.
- `docker-compose.yml`  runs everything on Docker Desktop. Nothing is deployed, nothing real is charged or emailed.

## Run it

    docker compose up -d          # first run installs packages, takes a few minutes
    docker compose ps
    docker compose down           # stop, keeps data
    docker compose down -v        # stop and wipe the database

| Part     | Address                       |
|----------|-------------------------------|
| App      | http://localhost:3000         |
| Website  | http://localhost:3100         |
| API      | http://localhost:4000/health  |
| Database | localhost:5440 (parakh / parakh) |

## Sign-in codes and emails

Emails are printed in the API log. To see the latest code:

    docker compose logs api --since 5m | Select-String "Your Parakh|code is"

Payments use the simulated checkout, so publishing and joining need no card.

## Run the tests against this database

    docker compose exec api sh -c "cd /app && npm test -w @parakh/api"
