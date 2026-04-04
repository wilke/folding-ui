# Folding UI

Web interface for the BV-BRC protein structure prediction pipeline. Submit prediction jobs using Boltz-2, Chai-1, AlphaFold 2, or ESMFold, then view results with interactive 3D structure visualization, confidence scores, and characterization reports.

## Features

- **Standard mode** — Guided wizard or advanced form with auto tool selection
- **Expert mode** — Individual tool workflows with full parameter control
- **Entity inputs** — Protein, DNA, RNA, ligands (CCD), SMILES, glycans
- **Results viewer** — 3Dmol.js structure viewer, pLDDT charts, confidence metrics, reports
- **Workspace integration** — Browse, upload, and manage files in BV-BRC workspace
- **Live job tracking** — SSE-based status updates with task logs

## Prerequisites

- [Node.js](https://nodejs.org/) 22+ (for local development)
- [Docker](https://docs.docker.com/get-docker/) (for containerized deployment)
- A running [GoWe](https://github.com/wilke/GoWe) instance for CWL workflow execution
- A BV-BRC account for authentication and workspace access

## Quick Start with Docker Compose

From the **workspace root** (parent directory containing `docker-compose.yml`):

```bash
docker compose up --build -d
```

The app is served at **http://localhost:8088/folding/**.

To rebuild after code changes:

```bash
docker compose up --build -d
```

To stop:

```bash
docker compose down
```

## Docker Build (standalone)

Build the image directly from the `folding-ui/` directory:

```bash
docker build -t folding-ui .
```

Run the container:

```bash
docker run -d -p 8088:80 --name folding-ui folding-ui
```

Open **http://localhost:8088/folding/** in your browser.

## Local Development

```bash
npm install
npm run dev
```

The Vite dev server starts at **http://localhost:5173/folding/** with hot module replacement. API calls are proxied to the configured backend services (GoWe, BV-BRC Auth, Workspace).

### Build for production

```bash
npm run build
npm run preview    # Preview the production build locally
```

## Project Structure

```
src/
  api/           API clients (GoWe, Workspace, CWL output parser)
  components/    Reusable UI components (forms, viewers, selectors)
  hooks/         React hooks (auth, settings, SSE)
  pages/         Route pages (Submit, Jobs list, Job detail)
  styles/        CSS with theme variables
```

## Configuration

### Nginx Proxy (Docker)

The production container uses nginx to serve the SPA and proxy API requests. Backend URLs are configured in `nginx.conf`:

| Route | Backend | Purpose |
|-------|---------|---------|
| `/folding/api/` | GoWe | CWL workflow engine REST API |
| `/folding/auth/` | BV-BRC User Service | Authentication |
| `/folding/ws-api/` | BV-BRC Workspace | File storage JSON-RPC |

### Vite Proxy (Development)

The same routes are proxied during local development via `vite.config.ts`.

## Workflow Modes

| Mode | Setting | Workflow | Description |
|------|---------|----------|-------------|
| **Standard** | `unified` | `protein-structure-prediction` | Single workflow, tool selected as input parameter |
| **Expert** | `individual` | `boltz-report`, `chai-report`, etc. | Per-tool workflows with full parameter control |

Switch between modes in the settings dropdown (top-right).

## License

See repository license.
