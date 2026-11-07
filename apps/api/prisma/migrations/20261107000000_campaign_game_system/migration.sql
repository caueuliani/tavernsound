-- Additive migration: legacy campaigns remain playable with the generic system.
ALTER TABLE "Campaign" ADD COLUMN "gameSystemId" TEXT NOT NULL DEFAULT 'generic';
