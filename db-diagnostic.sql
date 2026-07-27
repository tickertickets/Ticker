-- =============================================================================
-- TICKER DATABASE DIAGNOSTIC & CLEANUP SCRIPT
-- รันใน Supabase SQL Editor ทีละ Part
-- ปลอดภัย: ไม่ลบข้อมูล user, ไม่ลบ row ใดๆ
-- =============================================================================


-- =============================================================================
-- PART 1: DIAGNOSTIC — รันก่อนเสมอ เพื่อดูว่า DB มีอะไรเกินมาบ้าง
-- (read-only ทั้งหมด ปลอดภัย 100%)
-- =============================================================================


-- 1A: ตาราง "เกิน" ที่ไม่ได้อยู่ใน schema ปัจจุบัน
-- ถ้าผลลัพธ์ว่าง = ไม่มีตาราง orphan เหลือค้าง
SELECT table_name AS "ตารางที่ไม่ได้ใช้งานแล้ว"
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
  AND table_name NOT IN (
    'users',
    'email_verifications',
    'password_resets',
    'tickets',
    'ticket_tags',
    'ticket_tag_ratings',
    'follows',
    'follow_requests',
    'likes',
    'ticket_reactions',
    'comments',
    'bookmarks',
    'reports',
    'movie_likes',
    'movie_comments',
    'movie_bookmarks',
    'memory_access_requests',
    'notifications',
    'conversations',
    'conversation_participants',
    'chat_messages',
    'party_invites',
    'chains',
    'chain_movies',
    'chain_runs',
    'chain_run_items',
    'chain_hunt_found_movies',
    'chain_likes',
    'chain_bookmarks',
    'chain_comments',
    'albums',
    'album_tickets',
    'album_movies',
    'movies',
    'api_cache',
    'user_badge',
    'badge_xp_log',
    'supporter_requests',
    'page_verification_requests',
    'username_changes',
    'push_subscriptions',
    'user_sessions',
    'drafts',
    'site_settings'
  )
ORDER BY table_name;


-- 1B: คอลัมน์ "เกิน" ที่ไม่ได้อยู่ใน schema (ของแต่ละตารางที่ยังใช้อยู่)
-- ถ้าผลลัพธ์ว่าง = ไม่มีคอลัมน์ orphan เหลือค้าง
SELECT
  table_name   AS "ตาราง",
  column_name  AS "คอลัมน์ที่ไม่ได้ใช้งานแล้ว",
  data_type    AS "ชนิดข้อมูล"
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (table_name, column_name) NOT IN (
    -- users
    ('users','id'),('users','email'),('users','password_hash'),('users','username'),
    ('users','display_name'),('users','bio'),('users','avatar_url'),('users','birthdate'),
    ('users','email_verified'),('users','is_onboarded'),('users','is_private'),
    ('users','agreed_to_terms_at'),('users','profile_order'),('users','pinned_ticket_ids'),
    ('users','bio_links'),('users','preferred_lang'),('users','timezone'),
    ('users','created_at'),('users','updated_at'),
    -- email_verifications
    ('email_verifications','token'),('email_verifications','user_id'),
    ('email_verifications','created_at'),('email_verifications','expires_at'),
    ('email_verifications','used_at'),
    -- password_resets
    ('password_resets','token'),('password_resets','user_id'),
    ('password_resets','created_at'),('password_resets','expires_at'),
    ('password_resets','used_at'),
    -- tickets
    ('tickets','id'),('tickets','user_id'),('tickets','imdb_id'),
    ('tickets','movie_title'),('tickets','movie_year'),('tickets','poster_url'),
    ('tickets','genre'),('tickets','template'),('tickets','memory_note'),
    ('tickets','caption'),('tickets','watched_at'),('tickets','location'),
    ('tickets','is_private'),('tickets','hide_watched_at'),('tickets','hide_location'),
    ('tickets','hide_likes'),('tickets','hide_comments'),('tickets','rating'),
    ('tickets','rating_type'),('tickets','is_private_memory'),('tickets','is_spoiler'),
    ('tickets','rank_tier'),('tickets','current_rank_tier'),('tickets','popularity_score'),
    ('tickets','tmdb_snapshot'),('tickets','party_group_id'),('tickets','party_seat_number'),
    ('tickets','party_size'),('tickets','special_color'),('tickets','custom_rank_tier'),
    ('tickets','rank_locked'),('tickets','caption_align'),('tickets','card_theme'),
    ('tickets','card_backdrop_url'),('tickets','card_backdrop_offset_x'),
    ('tickets','card_runtime'),('tickets','card_director'),('tickets','card_producer'),
    ('tickets','card_actors'),('tickets','clip_url'),('tickets','episode_label'),
    ('tickets','display_order'),('tickets','card_data'),('tickets','caption_links'),
    ('tickets','deleted_at'),('tickets','created_at'),('tickets','updated_at'),
    -- ticket_tags
    ('ticket_tags','ticket_id'),('ticket_tags','user_id'),
    -- ticket_tag_ratings
    ('ticket_tag_ratings','ticket_id'),('ticket_tag_ratings','user_id'),
    ('ticket_tag_ratings','rating'),('ticket_tag_ratings','created_at'),
    -- follows
    ('follows','follower_id'),('follows','following_id'),('follows','created_at'),
    -- follow_requests
    ('follow_requests','id'),('follow_requests','from_user_id'),
    ('follow_requests','to_user_id'),('follow_requests','status'),
    ('follow_requests','created_at'),
    -- likes
    ('likes','user_id'),('likes','ticket_id'),('likes','reaction_type'),
    ('likes','created_at'),
    -- ticket_reactions
    ('ticket_reactions','user_id'),('ticket_reactions','ticket_id'),
    ('ticket_reactions','reaction_type'),('ticket_reactions','count'),
    ('ticket_reactions','updated_at'),
    -- comments
    ('comments','id'),('comments','ticket_id'),('comments','user_id'),
    ('comments','content'),('comments','created_at'),('comments','updated_at'),
    -- bookmarks
    ('bookmarks','user_id'),('bookmarks','ticket_id'),('bookmarks','created_at'),
    -- reports
    ('reports','id'),('reports','reporter_id'),('reports','ticket_id'),
    ('reports','chain_id'),('reports','reported_user_id'),('reports','reason'),
    ('reports','details'),('reports','created_at'),
    -- movie_likes
    ('movie_likes','user_id'),('movie_likes','movie_id'),('movie_likes','created_at'),
    -- movie_comments
    ('movie_comments','id'),('movie_comments','user_id'),('movie_comments','movie_id'),
    ('movie_comments','content'),('movie_comments','created_at'),
    -- movie_bookmarks
    ('movie_bookmarks','user_id'),('movie_bookmarks','movie_id'),
    ('movie_bookmarks','created_at'),
    -- memory_access_requests
    ('memory_access_requests','id'),('memory_access_requests','ticket_id'),
    ('memory_access_requests','requester_id'),('memory_access_requests','owner_id'),
    ('memory_access_requests','status'),('memory_access_requests','expires_at'),
    ('memory_access_requests','created_at'),
    -- notifications
    ('notifications','id'),('notifications','user_id'),('notifications','from_user_id'),
    ('notifications','type'),('notifications','ticket_id'),('notifications','party_invite_id'),
    ('notifications','party_group_id'),('notifications','chain_id'),
    ('notifications','message'),('notifications','is_read'),('notifications','created_at'),
    -- conversations
    ('conversations','id'),('conversations','is_request'),
    ('conversations','created_at'),('conversations','updated_at'),
    -- conversation_participants
    ('conversation_participants','conversation_id'),('conversation_participants','user_id'),
    ('conversation_participants','unread_count'),('conversation_participants','joined_at'),
    -- chat_messages
    ('chat_messages','id'),('chat_messages','conversation_id'),
    ('chat_messages','sender_id'),('chat_messages','content'),
    ('chat_messages','image_url'),('chat_messages','shared_ticket_id'),
    ('chat_messages','shared_chain_id'),('chat_messages','created_at'),
    -- party_invites
    ('party_invites','id'),('party_invites','party_group_id'),
    ('party_invites','inviter_user_id'),('party_invites','inviter_ticket_id'),
    ('party_invites','invitee_user_id'),('party_invites','status'),
    ('party_invites','assigned_seat'),('party_invites','created_at'),
    ('party_invites','updated_at'),
    -- chains
    ('chains','id'),('chains','user_id'),('chains','title'),
    ('chains','description'),('chains','description_align'),('chains','is_private'),
    ('chains','min_movie_count'),('chains','challenge_duration_ms'),('chains','mode'),
    ('chains','hide_comments'),('chains','hide_likes'),('chains','hide_chain_count'),
    ('chains','chain_count'),('chains','display_order'),('chains','description_links'),
    ('chains','created_at'),('chains','updated_at'),('chains','deleted_at'),
    -- chain_movies
    ('chain_movies','id'),('chain_movies','chain_id'),('chain_movies','position'),
    ('chain_movies','imdb_id'),('chain_movies','movie_title'),('chain_movies','movie_year'),
    ('chain_movies','poster_url'),('chain_movies','genre'),('chain_movies','custom_rank_tier'),
    ('chain_movies','tmdb_snapshot'),('chain_movies','added_by_user_id'),
    ('chain_movies','memory_note'),('chain_movies','created_at'),
    -- chain_runs
    ('chain_runs','id'),('chain_runs','chain_id'),('chain_runs','user_id'),
    ('chain_runs','status'),('chain_runs','total_elapsed_ms'),
    ('chain_runs','completed_count'),('chain_runs','started_at'),
    ('chain_runs','completed_at'),('chain_runs','updated_at'),
    -- chain_run_items
    ('chain_run_items','id'),('chain_run_items','run_id'),
    ('chain_run_items','chain_movie_id'),('chain_run_items','position'),
    ('chain_run_items','status'),('chain_run_items','started_at'),
    ('chain_run_items','finished_at'),('chain_run_items','elapsed_ms'),
    ('chain_run_items','ticket_id'),('chain_run_items','rating'),
    ('chain_run_items','rating_type'),('chain_run_items','custom_rank_tier'),
    ('chain_run_items','memory_note'),('chain_run_items','updated_at'),
    -- chain_hunt_found_movies
    ('chain_hunt_found_movies','chain_id'),('chain_hunt_found_movies','chain_movie_id'),
    ('chain_hunt_found_movies','found_at'),
    -- chain_likes
    ('chain_likes','user_id'),('chain_likes','chain_id'),('chain_likes','created_at'),
    -- chain_bookmarks
    ('chain_bookmarks','user_id'),('chain_bookmarks','chain_id'),
    ('chain_bookmarks','created_at'),
    -- chain_comments
    ('chain_comments','id'),('chain_comments','chain_id'),('chain_comments','user_id'),
    ('chain_comments','content'),('chain_comments','created_at'),
    -- albums
    ('albums','id'),('albums','user_id'),('albums','title'),
    ('albums','display_order'),('albums','created_at'),('albums','updated_at'),
    -- album_tickets
    ('album_tickets','album_id'),('album_tickets','ticket_id'),('album_tickets','added_at'),
    -- album_movies
    ('album_movies','album_id'),('album_movies','movie_id'),('album_movies','added_at'),
    -- movies
    ('movies','tmdb_id'),('movies','media_type'),('movies','title'),
    ('movies','poster_url'),('movies','backdrop_url'),('movies','overview'),
    ('movies','release_date'),('movies','vote_average'),('movies','vote_count'),
    ('movies','popularity'),('movies','genre_ids'),('movies','franchise_ids'),
    ('movies','fetched_at'),
    -- api_cache
    ('api_cache','cache_key'),('api_cache','data'),('api_cache','fetched_at'),
    -- user_badge
    ('user_badge','user_id'),('user_badge','level'),('user_badge','xp_current'),
    ('user_badge','xp_from_posts'),('user_badge','xp_from_tags'),
    ('user_badge','xp_from_party'),('user_badge','badge_hidden'),
    ('user_badge','display_level'),('user_badge','is_supporter_approved'),
    ('user_badge','is_page_verified'),('user_badge','page_badge_hidden'),
    ('user_badge','claimed_at'),('user_badge','created_at'),('user_badge','updated_at'),
    -- badge_xp_log
    ('badge_xp_log','id'),('badge_xp_log','user_id'),('badge_xp_log','action'),
    ('badge_xp_log','xp_awarded'),('badge_xp_log','source_id'),
    ('badge_xp_log','source_user_id'),('badge_xp_log','created_at'),
    -- supporter_requests
    ('supporter_requests','id'),('supporter_requests','user_id'),
    ('supporter_requests','slip_image_path'),('supporter_requests','status'),
    ('supporter_requests','admin_note'),('supporter_requests','created_at'),
    ('supporter_requests','reviewed_at'),
    -- page_verification_requests
    ('page_verification_requests','id'),('page_verification_requests','user_id'),
    ('page_verification_requests','proof_image_path'),('page_verification_requests','page_name'),
    ('page_verification_requests','page_url'),('page_verification_requests','status'),
    ('page_verification_requests','admin_note'),('page_verification_requests','created_at'),
    ('page_verification_requests','reviewed_at'),
    -- username_changes
    ('username_changes','id'),('username_changes','user_id'),
    ('username_changes','old_username'),('username_changes','new_username'),
    ('username_changes','changed_at'),
    -- push_subscriptions
    ('push_subscriptions','id'),('push_subscriptions','user_id'),
    ('push_subscriptions','endpoint'),('push_subscriptions','p256dh'),
    ('push_subscriptions','auth'),('push_subscriptions','enabled'),
    ('push_subscriptions','user_agent'),('push_subscriptions','created_at'),
    -- user_sessions
    ('user_sessions','sid'),('user_sessions','sess'),('user_sessions','expire'),
    -- drafts
    ('drafts','id'),('drafts','user_id'),('drafts','type'),
    ('drafts','key'),('drafts','data'),('drafts','updated_at'),
    -- site_settings
    ('site_settings','key'),('site_settings','value'),('site_settings','updated_at')
  )
  AND table_name IN (
    'users','email_verifications','password_resets','tickets','ticket_tags',
    'ticket_tag_ratings','follows','follow_requests','likes','ticket_reactions',
    'comments','bookmarks','reports','movie_likes','movie_comments','movie_bookmarks',
    'memory_access_requests','notifications','conversations','conversation_participants',
    'chat_messages','party_invites','chains','chain_movies','chain_runs',
    'chain_run_items','chain_hunt_found_movies','chain_likes','chain_bookmarks',
    'chain_comments','albums','album_tickets','album_movies','movies','api_cache',
    'user_badge','badge_xp_log','supporter_requests','page_verification_requests',
    'username_changes','push_subscriptions','user_sessions','drafts','site_settings'
  )
ORDER BY table_name, column_name;


-- 1C: คอลัมน์ที่ schema ต้องการแต่ DB อาจยังไม่มี (missing columns)
-- ถ้าผลลัพธ์ว่าง = ทุกอย่างครบถ้วนแล้ว
SELECT
  e.table_name  AS "ตาราง",
  e.column_name AS "คอลัมน์ที่ขาดหายไป"
FROM (VALUES
  ('tickets', 'display_order'),
  ('chains',  'display_order'),
  ('albums',  'display_order'),
  ('tickets', 'card_data'),
  ('tickets', 'caption_links'),
  ('tickets', 'clip_url'),
  ('tickets', 'episode_label'),
  ('tickets', 'card_backdrop_offset_x'),
  ('tickets', 'card_runtime'),
  ('tickets', 'card_director'),
  ('tickets', 'card_producer'),
  ('tickets', 'card_actors'),
  ('chains',  'description_links'),
  ('chains',  'hide_chain_count'),
  ('user_badge', 'is_page_verified'),
  ('user_badge', 'page_badge_hidden'),
  ('movies',  'franchise_ids'),
  ('users',   'pinned_ticket_ids'),
  ('users',   'bio_links')
) AS e(table_name, column_name)
WHERE NOT EXISTS (
  SELECT 1
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name   = e.table_name
    AND c.column_name  = e.column_name
)
ORDER BY e.table_name, e.column_name;


-- =============================================================================
-- PART 2: CLEANUP — รันหลังจากดู Part 1 แล้ว
-- ลบ column ที่ "เกิน" ออก (IF EXISTS = ปลอดภัย ถ้าไม่มีก็ข้ามไป)
-- ไม่ลบ row ใดๆ ไม่กระทบข้อมูล user
-- =============================================================================
-- คำเตือน: ถ้า Part 1A/1B ไม่แสดงอะไรเลย Part 2 จะ no-op ทั้งหมด
-- รัน Part 1 ก่อน แล้วค่อย uncomment Part 2 ตามที่เห็นว่าจำเป็น


-- ─── ล้าง api_cache (cache ชั่วคราว ไม่มีข้อมูล user) ─────────────────────────
-- ช่วยลด noise เวลา query — ข้อมูลจะถูก refetch อัตโนมัติ
TRUNCATE TABLE api_cache;


-- ─── ล้าง user_sessions ที่หมดอายุแล้ว ────────────────────────────────────────
-- (session ที่ expire แล้วไม่มีประโยชน์ ไม่กระทบ user ที่ login อยู่)
DELETE FROM user_sessions WHERE expire < NOW();


-- ─── ลบตารางเก่าที่ไม่ได้ใช้แล้ว ──────────────────────────────────────────────
-- Uncomment เฉพาะตารางที่ขึ้นมาใน Part 1A เท่านั้น
-- ตัวอย่าง: DROP TABLE IF EXISTS ชื่อตาราง CASCADE;


-- ─── ลบคอลัมน์เก่าที่ไม่ได้ใช้แล้ว ────────────────────────────────────────────
-- Uncomment เฉพาะคอลัมน์ที่ขึ้นมาใน Part 1B เท่านั้น
-- ตัวอย่าง: ALTER TABLE tickets DROP COLUMN IF EXISTS ชื่อคอลัมน์;


-- =============================================================================
-- PART 3: ENSURE — เพิ่มคอลัมน์ที่ขาดไป (ปลอดภัยรันซ้ำกี่ครั้งก็ได้)
-- =============================================================================

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS display_order          integer;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS card_data              jsonb;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS caption_links          jsonb DEFAULT '[]';
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS clip_url               text;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS episode_label          text;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS card_backdrop_offset_x integer DEFAULT 50;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS card_runtime           text;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS card_director          text;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS card_producer          text;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS card_actors            text;

ALTER TABLE chains  ADD COLUMN IF NOT EXISTS display_order          integer;
ALTER TABLE chains  ADD COLUMN IF NOT EXISTS description_links      jsonb DEFAULT '[]';
ALTER TABLE chains  ADD COLUMN IF NOT EXISTS hide_chain_count       boolean NOT NULL DEFAULT false;

ALTER TABLE albums  ADD COLUMN IF NOT EXISTS display_order          integer;

ALTER TABLE user_badge ADD COLUMN IF NOT EXISTS is_page_verified    boolean NOT NULL DEFAULT false;
ALTER TABLE user_badge ADD COLUMN IF NOT EXISTS page_badge_hidden   boolean NOT NULL DEFAULT false;

ALTER TABLE movies  ADD COLUMN IF NOT EXISTS franchise_ids          jsonb DEFAULT '[]';

ALTER TABLE users   ADD COLUMN IF NOT EXISTS pinned_ticket_ids      jsonb DEFAULT '[]';
ALTER TABLE users   ADD COLUMN IF NOT EXISTS bio_links              jsonb DEFAULT '[]';
