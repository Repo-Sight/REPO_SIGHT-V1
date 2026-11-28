REPO-SIGHT
Free static code analysis for C, C++, Python, Java, TypeScript, JavaScript and C#. Paste a public GitHub URL and get a graded health report: size, structure, complexity, duplication, security hotspots and rule violations. Sign-in is optional for public repositories and required for private ones.
Live site: https://www.repo-sight.com/
How it works
The browser sends a repository URL (or a single file) to a Vercel serverless function in `api/`.
The function downloads the source from GitHub. Public repositories are read from `main` or `master`. Private repositories need a GitHub sign-in with the REPO-SIGHT GitHub App installed, and are read from the default branch.
The prebuilt C++ analyser (`backend/bin/linux-x64-cma`, built from `analyser/`) lexes, parses and scores the source. Nothing from the repository is executed.
The JSON report is stored in Supabase Storage and rendered by the React frontend.
Hosted scans run against a time budget: the function passes the analyser `--time-budget-ms` (what is left of the 55 s window). If a very large repository cannot finish, the analyser stops early and the report carries `partial: { filesScanned, filesTotal }`; it describes an even sample of the files (visited in a fixed hash order, see `analyser/include/common/ScanBudget.h`), is shown with a notice, and never updates the live badge. Without the flag (CLI, GitHub Action) the analyser always scans everything.
The analyser has 117 rules across the seven languages (55 are security-specific). `.h` files count as C when a scan has `.c` files and no C++ source file, otherwise as C++. The authoritative list is `api/_lib/ruleCatalog.js`, also served at `/api/rules`.
Repository layout
Path	What it holds
`analyser/`	C++ engine: lexers, parsers, rules, metrics, report generation, unit tests
`api/`	Vercel serverless endpoints (`analyze`, `analyze-file`, `analyze-diff`, `rules`, `scans`, `badge`, `explain-finding`, `feedback`, `keepalive`, `welcome`, `event`; the live badge is served at `/badge/gh/:owner/:repo` by a `vercel.json` rewrite to `api/badge/[scanId].js`); `GET /api/scans/:id?format=sarif|json` exports a report as SARIF 2.1.0 or as JSON with repo-relative paths, under the same access rule as the report; every finding carries a stable `fp` fingerprint, see `api/_lib/fingerprint.js`); `POST`/`DELETE /api/scans/baseline` (handled inside the `scans` function to stay under the Hobby plan's 12-function limit) sets or clears the signed-in user's per-repo baseline, stored as finding fingerprint counts only; shared code lives in `api/_lib/` (not counted as functions)
`backend/bin/`	Prebuilt Linux x64 analyser binary used in production
`frontend/`	React + Vite + Tailwind app, prerendered to static HTML with `vite-react-ssg`
`scripts/`	API, badge, audit and diff tests; analyser binary drift check; non-deployed fixtures in `scripts/fixtures/`
Local development
```bash
# Frontend
cd frontend
npm ci
npm run dev          # dev server
npm run typecheck    # tsc --noEmit
npm run build        # prerender all pages into dist/
npm run check        # verify every page prerendered correctly

# API tests (from the repository root)
npm run test:api
```
The analyser is built with CMake (see `analyser/CMakeLists.txt`). Vercel does not compile C++, so whenever analyser source changes, rebuild it and commit the new `backend/bin/linux-x64-cma`; CI checks for binary drift.
Configuration
Database changes are SQL files in `supabase/migrations/`. Run each new file by hand in the Supabase SQL editor of both projects (production and preview) before deploying the code that uses it. Code that writes history or baselines fails soft when its table is missing, so scans keep working.

Secrets are environment variables set in Vercel and never committed. The API reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, plus `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`) for the finding explainer. For the one-time welcome email sent to new accounts (`api/welcome.js`) it reads `RESEND_API_KEY` and `WELCOME_FROM_EMAIL` (a sender on a domain verified in Resend, for example `REPO-SIGHT <hello@repo-sight.com>`), plus optionally `WELCOME_REPLY_TO`; if either of the first two is unset the endpoint sends nothing. `RESEND_API_KEY` is shared with the feedback notifier. The browser-side Supabase client settings are in `frontend/src/lib/supabase.ts`.
Branches
`main` is production and deploys to https://www.repo-sight.com/. V3 development happens on `Version3`, which Vercel builds as a preview deployment (previews use separate Supabase and API keys). Changes reach `main` by pull request after CI and the preview smoke test pass. `Version2` is kept as history. CI runs on `main`, `Version2` and `Version3`.
Open data
Scan results for 53 open-source projects are published at `frontend/public/data/open-source-scan-2026-10.csv` and discussed in the articles under `/learn/`.
License
Apache License 2.0. See `LICENSE`.
