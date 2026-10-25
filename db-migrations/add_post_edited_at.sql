-- Track explicit content edits separately from updated_at so changes to
-- privacy, visibility, activity, or display order do not look like edits.
-- Run manually in the Supabase SQL Editor before deploying the application.
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

ALTER TABLE public.chains
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;
