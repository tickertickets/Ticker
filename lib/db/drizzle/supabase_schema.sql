CREATE TYPE "public"."rank_tier" AS ENUM('common', 'rare', 'ultra', 'legendary', 'holographic', 'cult_classic');;
CREATE TYPE "public"."rating_type" AS ENUM('star', 'blackhole');;
CREATE TYPE "public"."special_color" AS ENUM('bronze', 'silver', 'gold', 'diamond');;
CREATE TYPE "public"."ticket_template" AS ENUM('classic', 'holographic', 'retro');;
CREATE TYPE "public"."memory_access_status" AS ENUM('pending', 'approved', 'denied');;
CREATE TYPE "public"."report_reason" AS ENUM('spam', 'inappropriate', 'harassment', 'other');;
CREATE TYPE "public"."notification_type" AS ENUM('like', 'comment', 'follow', 'follow_request', 'tag', 'ticket_share', 'party_invite', 'party_color_unlock', 'party_color_reverted', 'memory_request', 'memory_approved', 'supporter_approved', 'page_verified_approved', 'admin_message', 'chain_continued', 'chain_run_started', 'chain_like', 'chain_comment');;
CREATE TYPE "public"."party_invite_status" AS ENUM('pending', 'accepted', 'declined');;
CREATE TYPE "public"."badge_level" AS ENUM('1', '2', '3', '4', '5');;
CREATE TYPE "public"."badge_xp_action" AS ENUM('post_ticket', 'post_chain', 'tag_friend', 'party_accept');;
CREATE TYPE "public"."supporter_request_status" AS ENUM('pending', 'approved', 'rejected');;
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"username" text,
	"display_name" text,
	"bio" text,
	"avatar_url" text,
	"birthdate" date,
	"email_verified" boolean DEFAULT false NOT NULL,
	"is_onboarded" boolean DEFAULT false NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"agreed_to_terms_at" timestamp with time zone,
	"profile_order" text,
	"pinned_ticket_ids" jsonb DEFAULT '[]'::jsonb,
	"bio_links" jsonb DEFAULT '[]'::jsonb,
	"preferred_lang" text DEFAULT 'en' NOT NULL,
	"timezone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
;
CREATE TABLE "email_verifications" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
;
CREATE TABLE "password_resets" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
;
CREATE TABLE "ticket_tag_ratings" (
	"ticket_id" text NOT NULL,
	"user_id" text NOT NULL,
	"rating" numeric(3, 1) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_tag_ratings_ticket_user_uniq" UNIQUE("ticket_id","user_id")
);
;
CREATE TABLE "ticket_tags" (
	"ticket_id" text NOT NULL,
	"user_id" text NOT NULL
);
;
CREATE TABLE "tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"imdb_id" text NOT NULL,
	"movie_title" text NOT NULL,
	"movie_year" text,
	"poster_url" text,
	"genre" text,
	"template" "ticket_template" DEFAULT 'classic' NOT NULL,
	"memory_note" text,
	"caption" text,
	"watched_at" date,
	"location" text,
	"is_private" boolean DEFAULT false NOT NULL,
	"hide_watched_at" boolean DEFAULT false NOT NULL,
	"hide_location" boolean DEFAULT false NOT NULL,
	"hide_likes" boolean DEFAULT false NOT NULL,
	"hide_comments" boolean DEFAULT false NOT NULL,
	"rating" numeric(3, 1),
	"rating_type" "rating_type" DEFAULT 'star' NOT NULL,
	"is_private_memory" boolean DEFAULT false NOT NULL,
	"is_spoiler" boolean DEFAULT false NOT NULL,
	"rank_tier" "rank_tier" DEFAULT 'common' NOT NULL,
	"current_rank_tier" "rank_tier" DEFAULT 'common' NOT NULL,
	"popularity_score" integer DEFAULT 0 NOT NULL,
	"tmdb_snapshot" text,
	"party_group_id" text,
	"party_seat_number" integer,
	"party_size" integer,
	"special_color" "special_color",
	"custom_rank_tier" text,
	"rank_locked" boolean DEFAULT false NOT NULL,
	"caption_align" text DEFAULT 'left',
	"card_theme" text DEFAULT 'classic',
	"card_backdrop_url" text,
	"card_backdrop_offset_x" integer DEFAULT 50,
	"card_runtime" text,
	"card_director" text,
	"card_producer" text,
	"card_actors" text,
	"clip_url" text,
	"episode_label" text,
	"display_order" integer,
	"card_data" jsonb,
	"caption_links" jsonb DEFAULT '[]'::jsonb,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "bookmarks" (
	"user_id" text NOT NULL,
	"ticket_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "comments" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"user_id" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "follow_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"from_user_id" text NOT NULL,
	"to_user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "follows" (
	"follower_id" text NOT NULL,
	"following_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "likes" (
	"user_id" text NOT NULL,
	"ticket_id" text NOT NULL,
	"reaction_type" text DEFAULT 'heart' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "memory_access_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"requester_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"status" "memory_access_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "movie_bookmarks" (
	"user_id" text NOT NULL,
	"movie_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "movie_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"movie_id" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "movie_likes" (
	"user_id" text NOT NULL,
	"movie_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"reporter_id" text NOT NULL,
	"ticket_id" text,
	"chain_id" text,
	"reported_user_id" text,
	"reason" "report_reason" NOT NULL,
	"details" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "ticket_reactions" (
	"user_id" text NOT NULL,
	"ticket_id" text NOT NULL,
	"reaction_type" text NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_reactions_user_id_ticket_id_reaction_type_pk" PRIMARY KEY("user_id","ticket_id","reaction_type")
);
;
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"from_user_id" text NOT NULL,
	"type" "notification_type" NOT NULL,
	"ticket_id" text,
	"party_invite_id" text,
	"party_group_id" text,
	"chain_id" text,
	"message" text NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"sender_id" text NOT NULL,
	"content" text,
	"image_url" text,
	"shared_ticket_id" text,
	"shared_chain_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "conversation_participants" (
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"is_request" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "party_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"party_group_id" text NOT NULL,
	"inviter_user_id" text NOT NULL,
	"inviter_ticket_id" text NOT NULL,
	"invitee_user_id" text NOT NULL,
	"status" "party_invite_status" DEFAULT 'pending' NOT NULL,
	"assigned_seat" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "chain_bookmarks" (
	"user_id" text NOT NULL,
	"chain_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_bookmarks_user_id_chain_id_pk" PRIMARY KEY("user_id","chain_id")
);
;
CREATE TABLE "chain_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" text NOT NULL,
	"user_id" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "chain_hunt_found_movies" (
	"chain_id" text NOT NULL,
	"chain_movie_id" text NOT NULL,
	"found_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_hunt_found_movies_chain_id_chain_movie_id_pk" PRIMARY KEY("chain_id","chain_movie_id")
);
;
CREATE TABLE "chain_likes" (
	"user_id" text NOT NULL,
	"chain_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_likes_user_id_chain_id_pk" PRIMARY KEY("user_id","chain_id")
);
;
CREATE TABLE "chain_movies" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" text NOT NULL,
	"position" integer NOT NULL,
	"imdb_id" text NOT NULL,
	"movie_title" text NOT NULL,
	"movie_year" text,
	"poster_url" text,
	"genre" text,
	"custom_rank_tier" text,
	"tmdb_snapshot" text,
	"added_by_user_id" text,
	"memory_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "chain_run_items" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"chain_movie_id" text NOT NULL,
	"position" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"elapsed_ms" integer,
	"ticket_id" text,
	"rating" integer,
	"rating_type" text,
	"custom_rank_tier" text,
	"memory_note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "chain_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'live' NOT NULL,
	"total_elapsed_ms" integer DEFAULT 0 NOT NULL,
	"completed_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "chains" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"description_align" text DEFAULT 'left' NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"min_movie_count" integer DEFAULT 2 NOT NULL,
	"challenge_duration_ms" integer,
	"mode" text DEFAULT 'standard' NOT NULL,
	"hide_comments" boolean DEFAULT false NOT NULL,
	"hide_likes" boolean DEFAULT false NOT NULL,
	"hide_chain_count" boolean DEFAULT false NOT NULL,
	"chain_count" integer DEFAULT 0 NOT NULL,
	"display_order" integer,
	"description_links" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
;
CREATE TABLE "album_movies" (
	"album_id" text NOT NULL,
	"movie_id" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "album_movies_movie_unique" UNIQUE("movie_id")
);
;
CREATE TABLE "album_tickets" (
	"album_id" text NOT NULL,
	"ticket_id" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "album_tickets_ticket_unique" UNIQUE("ticket_id")
);
;
CREATE TABLE "albums" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"display_order" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "api_cache" (
	"cache_key" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "movies" (
	"tmdb_id" integer PRIMARY KEY NOT NULL,
	"media_type" text DEFAULT 'movie' NOT NULL,
	"title" text NOT NULL,
	"poster_url" text,
	"backdrop_url" text,
	"overview" text,
	"release_date" text,
	"vote_average" numeric(4, 2),
	"vote_count" integer,
	"popularity" numeric(12, 4),
	"genre_ids" jsonb,
	"franchise_ids" jsonb DEFAULT '[]'::jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "badge_xp_log" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"action" "badge_xp_action" NOT NULL,
	"xp_awarded" integer NOT NULL,
	"source_id" text NOT NULL,
	"source_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "page_verification_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"proof_image_path" text,
	"page_name" text NOT NULL,
	"page_url" text,
	"status" "supporter_request_status" DEFAULT 'pending' NOT NULL,
	"admin_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
;
CREATE TABLE "supporter_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"slip_image_path" text,
	"status" "supporter_request_status" DEFAULT 'pending' NOT NULL,
	"admin_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
;
CREATE TABLE "user_badge" (
	"user_id" text PRIMARY KEY NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"xp_current" integer DEFAULT 0 NOT NULL,
	"xp_from_posts" integer DEFAULT 0 NOT NULL,
	"xp_from_tags" integer DEFAULT 0 NOT NULL,
	"xp_from_party" integer DEFAULT 0 NOT NULL,
	"badge_hidden" boolean DEFAULT false NOT NULL,
	"display_level" integer,
	"is_supporter_approved" boolean DEFAULT false NOT NULL,
	"is_page_verified" boolean DEFAULT false NOT NULL,
	"page_badge_hidden" boolean DEFAULT false NOT NULL,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "username_changes" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"old_username" text NOT NULL,
	"new_username" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
;
CREATE TABLE "user_sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" json NOT NULL,
	"expire" timestamp NOT NULL
);
;
CREATE TABLE "drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"key" text NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drafts_user_type_key_uniq" UNIQUE("user_id","type","key")
);
;
CREATE TABLE "site_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "wiki_item_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"wiki_item_id" text NOT NULL,
	"user_id" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
;
CREATE TABLE "wiki_item_likes" (
	"user_id" text NOT NULL,
	"wiki_item_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_item_likes_user_id_wiki_item_id_pk" PRIMARY KEY("user_id","wiki_item_id")
);
;
CREATE TABLE "wiki_items" (
	"id" text PRIMARY KEY NOT NULL,
	"wiki_page_id" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text,
	"thumbnail_url" text,
	"url" text NOT NULL,
	"lang" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_items_wiki_page_id_unique" UNIQUE("wiki_page_id")
);
;
ALTER TABLE "email_verifications" ADD CONSTRAINT "email_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "ticket_tag_ratings" ADD CONSTRAINT "ticket_tag_ratings_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "ticket_tag_ratings" ADD CONSTRAINT "ticket_tag_ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "ticket_tags" ADD CONSTRAINT "ticket_tags_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "ticket_tags" ADD CONSTRAINT "ticket_tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "comments" ADD CONSTRAINT "comments_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "comments" ADD CONSTRAINT "comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "follow_requests" ADD CONSTRAINT "follow_requests_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "follow_requests" ADD CONSTRAINT "follow_requests_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "follows" ADD CONSTRAINT "follows_following_id_users_id_fk" FOREIGN KEY ("following_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "likes" ADD CONSTRAINT "likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "likes" ADD CONSTRAINT "likes_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "memory_access_requests" ADD CONSTRAINT "memory_access_requests_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "memory_access_requests" ADD CONSTRAINT "memory_access_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "memory_access_requests" ADD CONSTRAINT "memory_access_requests_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "movie_bookmarks" ADD CONSTRAINT "movie_bookmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "movie_comments" ADD CONSTRAINT "movie_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "movie_likes" ADD CONSTRAINT "movie_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "reports" ADD CONSTRAINT "reports_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "reports" ADD CONSTRAINT "reports_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "reports" ADD CONSTRAINT "reports_reported_user_id_users_id_fk" FOREIGN KEY ("reported_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "ticket_reactions" ADD CONSTRAINT "ticket_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "ticket_reactions" ADD CONSTRAINT "ticket_reactions_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_shared_ticket_id_tickets_id_fk" FOREIGN KEY ("shared_ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_shared_chain_id_chains_id_fk" FOREIGN KEY ("shared_chain_id") REFERENCES "public"."chains"("id") ON DELETE set null ON UPDATE no action;;
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "party_invites" ADD CONSTRAINT "party_invites_inviter_user_id_users_id_fk" FOREIGN KEY ("inviter_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "party_invites" ADD CONSTRAINT "party_invites_inviter_ticket_id_tickets_id_fk" FOREIGN KEY ("inviter_ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "party_invites" ADD CONSTRAINT "party_invites_invitee_user_id_users_id_fk" FOREIGN KEY ("invitee_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "chain_bookmarks" ADD CONSTRAINT "chain_bookmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "chain_bookmarks" ADD CONSTRAINT "chain_bookmarks_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "chain_comments" ADD CONSTRAINT "chain_comments_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "chain_comments" ADD CONSTRAINT "chain_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "chain_hunt_found_movies" ADD CONSTRAINT "chain_hunt_found_movies_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "chain_hunt_found_movies" ADD CONSTRAINT "chain_hunt_found_movies_chain_movie_id_chain_movies_id_fk" FOREIGN KEY ("chain_movie_id") REFERENCES "public"."chain_movies"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "chain_likes" ADD CONSTRAINT "chain_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "chain_likes" ADD CONSTRAINT "chain_likes_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "chain_movies" ADD CONSTRAINT "chain_movies_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "chain_movies" ADD CONSTRAINT "chain_movies_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;;
ALTER TABLE "chain_run_items" ADD CONSTRAINT "chain_run_items_run_id_chain_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."chain_runs"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "chain_run_items" ADD CONSTRAINT "chain_run_items_chain_movie_id_chain_movies_id_fk" FOREIGN KEY ("chain_movie_id") REFERENCES "public"."chain_movies"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "chain_runs" ADD CONSTRAINT "chain_runs_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "chain_runs" ADD CONSTRAINT "chain_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "chains" ADD CONSTRAINT "chains_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "album_movies" ADD CONSTRAINT "album_movies_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "album_tickets" ADD CONSTRAINT "album_tickets_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "album_tickets" ADD CONSTRAINT "album_tickets_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "albums" ADD CONSTRAINT "albums_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "badge_xp_log" ADD CONSTRAINT "badge_xp_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "page_verification_requests" ADD CONSTRAINT "page_verification_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "supporter_requests" ADD CONSTRAINT "supporter_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "user_badge" ADD CONSTRAINT "user_badge_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "username_changes" ADD CONSTRAINT "username_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "wiki_item_comments" ADD CONSTRAINT "wiki_item_comments_wiki_item_id_wiki_items_id_fk" FOREIGN KEY ("wiki_item_id") REFERENCES "public"."wiki_items"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "wiki_item_comments" ADD CONSTRAINT "wiki_item_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "wiki_item_likes" ADD CONSTRAINT "wiki_item_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "wiki_item_likes" ADD CONSTRAINT "wiki_item_likes_wiki_item_id_wiki_items_id_fk" FOREIGN KEY ("wiki_item_id") REFERENCES "public"."wiki_items"("id") ON DELETE cascade ON UPDATE no action;;
CREATE INDEX "tickets_user_id_created_at_idx" ON "tickets" USING btree ("user_id","created_at");;
CREATE INDEX "tickets_created_at_idx" ON "tickets" USING btree ("created_at");;
CREATE INDEX "tickets_user_id_imdb_id_idx" ON "tickets" USING btree ("user_id","imdb_id");;
CREATE INDEX "tickets_party_group_id_idx" ON "tickets" USING btree ("party_group_id");;
CREATE INDEX "bookmarks_user_id_idx" ON "bookmarks" USING btree ("user_id");;
CREATE INDEX "bookmarks_ticket_id_idx" ON "bookmarks" USING btree ("ticket_id");;
CREATE INDEX "comments_ticket_id_created_at_idx" ON "comments" USING btree ("ticket_id","created_at");;
CREATE INDEX "follows_follower_id_idx" ON "follows" USING btree ("follower_id");;
CREATE INDEX "follows_following_id_idx" ON "follows" USING btree ("following_id");;
CREATE INDEX "likes_ticket_id_idx" ON "likes" USING btree ("ticket_id");;
CREATE INDEX "likes_user_id_idx" ON "likes" USING btree ("user_id");;
CREATE INDEX "ticket_reactions_ticket_id_idx" ON "ticket_reactions" USING btree ("ticket_id");;
CREATE INDEX "ticket_reactions_user_id_idx" ON "ticket_reactions" USING btree ("user_id");;
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications" USING btree ("user_id","created_at");;
CREATE INDEX "notifications_user_id_is_read_idx" ON "notifications" USING btree ("user_id","is_read");;
CREATE INDEX "badge_xp_log_user_id_idx" ON "badge_xp_log" USING btree ("user_id");;
CREATE INDEX "badge_xp_log_user_action_date_idx" ON "badge_xp_log" USING btree ("user_id","action","created_at");;
CREATE UNIQUE INDEX "badge_xp_log_source_unique_idx" ON "badge_xp_log" USING btree ("user_id","action","source_id");;
CREATE INDEX "page_verify_requests_user_id_idx" ON "page_verification_requests" USING btree ("user_id");;
CREATE INDEX "page_verify_requests_status_idx" ON "page_verification_requests" USING btree ("status");;
CREATE INDEX "supporter_requests_user_id_idx" ON "supporter_requests" USING btree ("user_id");;
CREATE INDEX "supporter_requests_status_idx" ON "supporter_requests" USING btree ("status");;
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions" USING btree ("user_id");;
CREATE INDEX "IDX_session_expire" ON "user_sessions" USING btree ("expire");;
CREATE INDEX "wiki_item_comments_wiki_item_id_idx" ON "wiki_item_comments" USING btree ("wiki_item_id");;
CREATE INDEX "wiki_item_likes_wiki_item_id_idx" ON "wiki_item_likes" USING btree ("wiki_item_id");;
CREATE INDEX "wiki_items_wiki_page_id_idx" ON "wiki_items" USING btree ("wiki_page_id");CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "user_sessions" ("expire");
