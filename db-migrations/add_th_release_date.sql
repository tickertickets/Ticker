-- Add Thailand-specific release date column to movies cache table.
-- Run this in the Supabase SQL Editor.
ALTER TABLE movies ADD COLUMN IF NOT EXISTS th_release_date text;
