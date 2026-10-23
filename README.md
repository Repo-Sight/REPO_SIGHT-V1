# REPO-SIGHT

Free static code analysis for C++, Python, Java, TypeScript, JavaScript and C#. Paste a public GitHub URL and get a graded health report: size, structure, complexity, duplication, security hotspots and rule violations, with no account needed.

Live site: https://www.repo-sight.com/

## How it works

1. The browser sends a repository URL (or a single file) to a Vercel serverless function in `api/`.
2. The function downloads the source from GitHub. Public repositories are read from `main` or `master`. Private repositories need a GitHub sign-in with the REPO-SIGHT GitHub App installed, and are read from the default branch.
3. The prebuilt C++ analyser (`backend/bin/linux-x64-cma`, built from `analyser/`) lexes, parses and scores the source. Nothing from the repository is executed.
4. The JSON report is stored in Supabase Storage and rendered by the React frontend.

The analyser has 98 rules across the six languages (45 are security-specific). The authoritative list is `api/_lib/ruleCatalog.js`, also served at `/api/rules`.

## Repository layout

| Path | What it holds |
|---|---|
| `analyser/` | C++ engine: lexers, parsers, rules, metrics, report generation, unit tests |
| `api/` | Vercel serverless endpoints (`analyze`, `analyze-file`, `analyze-diff`, `slop`, `rules`, `scans`, `badge`, `explain-finding`, `feedback`, `keepalive`) |
| `backend/bin/` | Prebuilt Linux x64 analyser binary used in production |
| `frontend/` | React + Vite + Tailwind app, prerendered to static HTML with `vite-react-ssg` |
| `scripts/` | API, badge, audit and diff tests; analyser binary drift check |

## Local development

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

## Configuration

Secrets are environment variables set in Vercel and never committed. The API reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, plus `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`) for the finding explainer. For the one-time welcome email sent to new accounts (`api/welcome.js`) it reads `RESEND_API_KEY` and `WELCOME_FROM_EMAIL` (a sender on a domain verified in Resend, for example `REPO-SIGHT <hello@repo-sight.com>`), plus optionally `WELCOME_REPLY_TO`; if either of the first two is unset the endpoint sends nothing. `RESEND_API_KEY` is shared with the feedback notifier. The browser-side Supabase client settings are in `frontend/src/lib/supabase.ts`.

## Branches

`main` is production. Active development happens on `Version2`; changes reach `main` through a tested merge.

## Open data

Scan results for 53 open-source projects are published at `frontend/public/data/open-source-scan-2026-10.csv` and discussed in the articles under `/learn/`.

## License

Apache License 2.0. See `LICENSE`.
