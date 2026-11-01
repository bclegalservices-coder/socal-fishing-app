-- Nov 1: the download link that goes into group invite messages ("Don't have the app yet? Get it here: …").
-- Change it any time in Admin → Settings → invite_link (TestFlight public link now, the App Store link later).
insert into app_config (key, value, description) values
  ('invite_link', 'null', 'Download link put in Crew group invite messages (TestFlight public link, later the App Store). Empty = "ask me for the link".')
on conflict (key) do nothing;
