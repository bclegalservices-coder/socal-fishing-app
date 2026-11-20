# Fishing-spot source data — kept out of this repository on purpose

The SoCal fishing-spot lists (e.g. the SWYC Anglers list) are **licensed to Channel Nav for use in the app only**.
They are **not** redistributed here, and they must never be committed to this repository, especially now that it is
public.

Where the data actually lives:
- On the owner's own computer (a local copy of the `.gpx` / seed `.sql`), and
- In the app's Supabase database, already loaded.

These files are listed in `.gitignore` so they can't be added back by accident. If you need to re-load spots, use the
local copy with `tools/import_spots_gpx.py`; do not add the raw files to git.
