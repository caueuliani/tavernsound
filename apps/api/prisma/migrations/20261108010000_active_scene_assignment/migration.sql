-- Keep staged destinations separate from scenes actually activated in a session.
-- No existing assignment is activated by this migration.
ALTER TABLE "RoomSceneAssignment" ADD COLUMN "activeSceneId" TEXT;
CREATE INDEX "RoomSceneAssignment_activeSceneId_idx" ON "RoomSceneAssignment"("activeSceneId");
ALTER TABLE "RoomSceneAssignment" ADD CONSTRAINT "RoomSceneAssignment_activeSceneId_fkey"
  FOREIGN KEY ("activeSceneId") REFERENCES "Scene"("id") ON DELETE SET NULL ON UPDATE CASCADE;
