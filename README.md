# CSV Viewer

A fast, private CSV viewer that runs entirely in the browser. Open a local CSV
file, search every column, sort rows, paginate large tables, and export the
filtered result.

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deployment

Every push to `main` builds and deploys the static site with GitHub Actions.
In the repository settings, set **Pages → Build and deployment → Source** to
**GitHub Actions**.

The production URL is [kirans.me/csv-viewer](https://kirans.me/csv-viewer/).
