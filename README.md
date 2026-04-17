# BillLoans

This repository is prepared for GitHub Pages deployment.

## GitHub Pages

The repository keeps the main frontend in [Index.html](Index.html). During GitHub Pages deployment, the workflow generates a lowercase `index.html` from that file so the site opens at the repository root.

After pushing to `main`, GitHub Actions will deploy the site to GitHub Pages automatically using the workflow in [.github/workflows/pages.yml](.github/workflows/pages.yml).

Expected Pages URL:

- https://saknarin-git.github.io/BillLoans/

Notes:

- The frontend is still backed by Google Apps Script through the remote `google.script.run` proxy already embedded in [Index.html](Index.html).
- If you need to change the Apps Script Web App URL later, update `window.__GAS_WEB_APP_URL__` in [Index.html](Index.html).