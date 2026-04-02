# Connect Artists Public

Public-facing repository for a graph-based music exploration project centered on artist relationships, path finding, and browser-side MixDNA lite.

## What to upload to GitHub

Upload this whole `connect-artists-public` folder as the repository.

The site bundle lives in `docs/`, which means the repo can be published directly with GitHub Pages or Cloudflare Pages.

## Repo layout

- `web/`: editable source HTML.
- `docs/`: ready-to-publish static site bundle.
- `pipeline/`: data-preparation scripts used to build the public assets.
- `scripts/`: build scripts for regenerating the public site.
- `core/`: shared configuration and helpers.
- `assets/screenshots/`: images for GitHub and LinkedIn.
- `data/`: local-only generated artifacts, intentionally ignored by git.

## What is intentionally excluded

- Raw Spotify-derived parquet data.
- Heavy model artifacts and generated arrays.
- Temporary DuckDB spill files.

## How the web works

The public website is already contained in `docs/`.

If you update the source HTML or regenerate public assets locally, rebuild it with:

```bash
python scripts/build_connect_artists_site.py
```

## Publishing options

### GitHub Pages

1. Push this repository to GitHub.
2. Go to `Settings > Pages`.
3. Select `Deploy from a branch`.
4. Choose the `main` branch and the `/docs` folder.
5. Save.

### Cloudflare Pages

1. Import the GitHub repository into Cloudflare Pages.
2. Set the output directory to `docs`.
3. No build command is required if `docs/` is already committed.

## Notes

This repository is structured for publication and portfolio use. It does not include the original large datasets or full private workspace, but it can include the lightweight public bundle needed for the demo.
