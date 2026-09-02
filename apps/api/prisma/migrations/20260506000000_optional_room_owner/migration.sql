-- Room.ownerId se torna opcional para suportar salas criadas antes da integração de auth

ALTER TABLE "Room" DROP CONSTRAINT "Room_ownerId_fkey";
ALTER TABLE "Room" ALTER COLUMN "ownerId" DROP NOT NULL;
ALTER TABLE "Room" ADD CONSTRAINT "Room_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
