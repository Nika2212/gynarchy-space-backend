ALTER TABLE "medias" ADD COLUMN "identifier" text NOT NULL;--> statement-breakpoint
ALTER TABLE "medias" ADD CONSTRAINT "medias_identifier_unique" UNIQUE("identifier");