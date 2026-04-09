CREATE TABLE "medias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"thumbnail_src" jsonb NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"posted_at" text NOT NULL,
	"duration" integer NOT NULL,
	"is_downloaded" boolean DEFAULT false NOT NULL,
	"is_liked" boolean DEFAULT false NOT NULL,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"watched_at" timestamp with time zone,
	"watched_times" integer DEFAULT 0 NOT NULL,
	"watch_position_at" integer,
	CONSTRAINT "medias_url_unique" UNIQUE("url")
);
