# NorthStar

IT Operational Command System powered by Neo4j Ontology. Inspired by Palantir Ontology, builds a knowledge graph of IT architecture assets from draw.io diagrams stored in Lenovo's Confluence Architecture Review space.

See `docs/superpowers/specs/2026-04-09-northstar-mvp-design.md` for the full MVP design.

## Architecture

```
Next.js 15 frontend → FastAPI backend → Neo4j CE
                               ↓
                    Confluence REST API
                    (or local .drawio files)
```

- **Frontend** — Next.js 14 + TypeScript, Cytoscape.js graph viewer, Recharts dashboard
- **Backend** — Python FastAPI, async Neo4j driver, draw.io parser reused from EGM
- **Graph DB** — Neo4j Community Edition in Docker
- **Ingestion** — Confluence REST API → drawio_parser → AI evaluator → Neo4j MERGE

## Local / remote deployment

This project is designed for **local dev + remote deploy on server 71 (192.168.68.71)**. You write code locally, commit, push; pull on 71 and `docker compose up --build`.

### First-time setup on 71

```bash
ssh northstar-server
cd ~
git clone https://github.com/Ruodong/NorthStar.git
cd NorthStar
cp .env.example .env
# edit .env — at minimum set NEO4J_PASSWORD
docker compose up -d --build
```

### Services exposed on 71

| Service | Port | URL |
|---------|------|-----|
| Frontend | 3003 | http://192.168.68.71:3003 |
| Backend API | 8001 | http://192.168.68.71:8001 |
| Neo4j Browser | 7474 | http://192.168.68.71:7474 |
| Neo4j Bolt | 7687 | bolt://192.168.68.71:7687 |

### Dev loop

```bash
# locally: edit, commit, push
git add . && git commit -m "..." && git push

# on 71: pull and rebuild the changed service
ssh northstar-server 'cd ~/NorthStar && git pull && docker compose up -d --build backend'
```

Rebuild `frontend` only when frontend files change; rebuild `backend` only for backend changes. Neo4j data persists in the `neo4j_data` volume.

## Running ingestion

1. Open the Ingestion Console: http://192.168.68.71:3003/ingestion
2. Pick one or more fiscal years (e.g. FY2526)
3. Click **Start ingestion**

If Confluence credentials are configured in `.env`, the pipeline fetches project pages from Confluence. Otherwise, it falls back to loading `.drawio` files from `data/local_drawio/<fiscal_year>/<project_id>__<name>/` — useful for offline testing.

## API reference

See the [design spec](docs/superpowers/specs/2026-04-09-northstar-mvp-design.md#api-design) for endpoint details. Full OpenAPI is served at `/docs` on the backend.

## Weekly sync (cron)

`scripts/weekly_sync.sh` runs the full cycle: EGM/EAM master data sync → Neo4j rebuild → fuzzy merge candidate refresh. It writes diffs to `ingestion_diffs`, so the `/whats-new` page picks up weekly changes automatically.

Install on server 71:

```bash
# one-time: make sure the host venv exists
cd ~/NorthStar
python3 -m venv .venv-ingest
.venv-ingest/bin/pip install psycopg[binary] neo4j

# add to crontab (crontab -e):
0 8 * * 1 /home/lenovo/NorthStar/scripts/weekly_sync.sh >> /var/log/northstar-sync.log 2>&1
```

This runs every Monday at 08:00 local time. Logs go to `/var/log/northstar-sync.log` (make sure the cron user can write to it, or change the path).

Run manually for the first time to populate `ingestion_diffs`:

```bash
./scripts/weekly_sync.sh
```

## Reused from EGM

| Component | EGM source |
|-----------|-----------|
| `backend/app/services/drawio_parser.py` | `EGM/backend/app/services/drawio_parser.py` |
| LLM JSON call pattern | `EGM/backend/app/services/ai_review_analysis.py` |
