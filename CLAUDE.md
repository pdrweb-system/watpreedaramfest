# CLAUDE.md

## Git workflow (required)
- Never commit directly to `main`. Create a branch for each change, push it, open a pull request to `main`, then merge the PR yourself straight away (squash merge) without waiting for confirmation.
- Pushing to `main` deploys to GitHub Pages automatically (`.github/workflows/pages.yml`).

## Project layout
- `index.html` + `config.js`: the survey page hosted on GitHub Pages. It sends data with `fetch` POST (`text/plain` JSON) to `SCRIPT_URL` in `config.js`.
- `apps-script/Code.gs`: the Google Apps Script API (`doPost`). It saves rows to Google Sheets and uploaded files to Google Drive. Changes here must be pasted into the Apps Script editor by hand and deployed as a new version.
- File limits (`MAX_FILES`, `MAX_FILE_MB`, `MAX_TOTAL_MB`) must match in `config.js` and `apps-script/Code.gs`.
- UI text is in Thai.
