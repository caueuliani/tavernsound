CREATE TYPE "TokenKind" AS ENUM ('PLAYER', 'SCENERY');
ALTER TABLE "Token" ADD COLUMN "kind" "TokenKind" NOT NULL DEFAULT 'PLAYER';

-- Legacy NPCs were created by the server with both this fixed name and a v4 UUID.
-- Uncertain historical rows remain PLAYER so they cannot be deleted as scenery.
UPDATE "Token"
SET "kind" = 'SCENERY'
WHERE "name" = 'Token de cenário'
  AND "id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
