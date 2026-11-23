-- Migration: add card_backdrop_offset_y to tickets table
-- Run this manually in the Supabase SQL Editor.
-- Adds the vertical pan offset for the Poster card theme (mirrors card_backdrop_offset_x).

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS card_backdrop_offset_y integer NOT NULL DEFAULT 50;
