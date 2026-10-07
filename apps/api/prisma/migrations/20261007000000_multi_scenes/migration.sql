CREATE TABLE "Scene" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "sceneData" JSONB,
    "mapUrl" TEXT,
    "fogData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Scene_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Scene_roomId_position_key" ON "Scene"("roomId", "position");
CREATE INDEX "Scene_roomId_idx" ON "Scene"("roomId");
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Keep the legacy room fields intact. Their exact data becomes scene one.
INSERT INTO "Scene" ("id", "roomId", "name", "position", "sceneData", "mapUrl", "fogData")
SELECT 'initial-' || "id", "id", 'Cena inicial', 0, "sceneData", "mapUrl", "fogOfWarData" FROM "Room";

ALTER TABLE "Token" ADD COLUMN "sceneId" TEXT;
UPDATE "Token" SET "sceneId" = 'initial-' || "roomId";
ALTER TABLE "Token" ALTER COLUMN "sceneId" SET NOT NULL;
CREATE INDEX "Token_sceneId_idx" ON "Token"("sceneId");
ALTER TABLE "Token" ADD CONSTRAINT "Token_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RoomSceneAssignment" (
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    CONSTRAINT "RoomSceneAssignment_pkey" PRIMARY KEY ("roomId", "userId")
);
CREATE INDEX "RoomSceneAssignment_sceneId_idx" ON "RoomSceneAssignment"("sceneId");
ALTER TABLE "RoomSceneAssignment" ADD CONSTRAINT "RoomSceneAssignment_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoomSceneAssignment" ADD CONSTRAINT "RoomSceneAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoomSceneAssignment" ADD CONSTRAINT "RoomSceneAssignment_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;
INSERT INTO "RoomSceneAssignment" ("roomId", "userId", "sceneId")
SELECT DISTINCT "roomId", "userId", 'initial-' || "roomId" FROM "RoomMember" WHERE "userId" IS NOT NULL
ON CONFLICT ("roomId", "userId") DO NOTHING;
