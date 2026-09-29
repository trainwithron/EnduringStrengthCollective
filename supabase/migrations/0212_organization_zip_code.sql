-- marketplace_gather_and_browse_ui_data_investigation_sept29.md — the
-- real, minimal location field Ron asked for ("it wouldn't be hard to
-- include a zip code... don't make it complicated, just make it
-- work") to unblock the marketplace browse UI's distance factor. A
-- plain, optional text column, not a full address/geocoding system —
-- real distance math is computed at query time from a bundled
-- ZIP-centroid dataset (the `zipcodes` npm package), no external
-- geocoding service or lat/lng columns needed.
alter table public.organizations
  add column zip_code text
  check (zip_code is null or zip_code ~ '^[0-9]{5}$');
