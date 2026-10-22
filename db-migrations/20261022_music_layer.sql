-- Ticker music layer. Additive only: existing movie tables and data are untouched.
-- Safe to paste into Supabase SQL Editor after taking a database backup.

CREATE TABLE IF NOT EXISTS public.music_items (
  provider_id text NOT NULL,
  entity text NOT NULL CHECK (entity IN ('song', 'album', 'artist')),
  name text NOT NULL,
  artist_name text,
  collection_name text,
  artwork_url text,
  preview_url text,
  item_url text,
  genre text,
  release_date text,
  duration_ms integer,
  track_count integer,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_id, entity)
);

CREATE INDEX IF NOT EXISTS music_items_entity_fetched_idx
  ON public.music_items (entity, fetched_at DESC);

CREATE TABLE IF NOT EXISTS public.music_vinyls (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  track_id text NOT NULL,
  item_snapshot jsonb NOT NULL,
  rating numeric(2,1) CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5)),
  caption text NOT NULL DEFAULT '',
  shape text NOT NULL DEFAULT 'vinyl' CHECK (shape IN ('vinyl', 'square')),
  is_private boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz
);

CREATE INDEX IF NOT EXISTS music_vinyls_user_created_idx
  ON public.music_vinyls (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS music_vinyls_created_idx
  ON public.music_vinyls (created_at DESC);

CREATE TABLE IF NOT EXISTS public.music_playlists (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
  description text NOT NULL DEFAULT '',
  cover_url text,
  is_private boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS music_playlists_user_created_idx
  ON public.music_playlists (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS music_playlists_created_idx
  ON public.music_playlists (created_at DESC);

CREATE TABLE IF NOT EXISTS public.music_playlist_items (
  playlist_id text NOT NULL REFERENCES public.music_playlists(id) ON DELETE CASCADE,
  track_id text NOT NULL,
  item_snapshot jsonb NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (playlist_id, track_id)
);

CREATE INDEX IF NOT EXISTS music_playlist_items_order_idx
  ON public.music_playlist_items (playlist_id, position);

CREATE TABLE IF NOT EXISTS public.music_saves (
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider_id text NOT NULL,
  entity text NOT NULL CHECK (entity IN ('song', 'album', 'artist')),
  item_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider_id, entity)
);

CREATE INDEX IF NOT EXISTS music_saves_item_idx
  ON public.music_saves (entity, provider_id);
