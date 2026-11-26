# CLAUDE.md

## Git workflow (required)
- Never commit directly to `main`. Create a branch for each change, push it, open a pull request to `main`, then merge the PR yourself straight away (squash merge) without waiting for confirmation.
- Pushing to `main` deploys to GitHub Pages automatically (`.github/workflows/pages.yml`).

## Project layout
- `summary.html`: public summary of submissions (school, level, show name, performer count only, no personal names). It GETs `SCRIPT_URL?action=list` (`listSubmissions_` in Code.gs, cached 60s).
- Shared styles live in `assets/style.css` (used by both pages); page-specific CSS stays inline.
- `index.html` + `config.js`: the survey page hosted on GitHub Pages. It sends data with `fetch` POST (`text/plain` JSON) to `SCRIPT_URL` in `config.js`.
- `apps-script/Code.gs`: the Google Apps Script API (`doPost`). It saves rows to Google Sheets and uploaded files to Google Drive. Changes here must be pasted into the Apps Script editor by hand and deployed as a new version.
- File limits (`MAX_FILES`, `MAX_FILE_MB`, `MAX_TOTAL_MB`) must match in `config.js` and `apps-script/Code.gs`.
- Uploads are chunked: the page calls `initUpload`, then `uploadChunk` (chunk size from the server, `CHUNK_MB`), then `submit` with `uploadIds`. Apps Script forwards each chunk to a Drive resumable upload session via `UrlFetchApp`.
- UI text is in Thai. Theme is green/white: colours live as CSS tokens in `:root` of `index.html` (`--primary` #047857 etc.); keep text contrast ≥ 4.5:1, touch targets ≥ 44px, SVG icons (no emoji).
