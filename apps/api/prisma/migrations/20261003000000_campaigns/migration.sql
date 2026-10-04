CREATE TYPE "CampaignStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');

CREATE TABLE "Campaign" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" "CampaignStatus" NOT NULL DEFAULT 'ACTIVE',
  "ownerId" TEXT NOT NULL,
  "inviteCode" TEXT,
  "inviteExpiry" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CampaignMember" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'PLAYER',
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampaignMember_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "GameSession" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "campaignId" TEXT,
  "name" TEXT,
  "description" TEXT,
  "notes" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "participantCount" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "GameSession_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Room" ADD COLUMN "campaignId" TEXT;
CREATE UNIQUE INDEX "Campaign_inviteCode_key" ON "Campaign"("inviteCode");
CREATE INDEX "Campaign_ownerId_idx" ON "Campaign"("ownerId");
CREATE INDEX "Campaign_inviteCode_idx" ON "Campaign"("inviteCode");
CREATE UNIQUE INDEX "CampaignMember_campaignId_userId_key" ON "CampaignMember"("campaignId", "userId");
CREATE INDEX "CampaignMember_campaignId_idx" ON "CampaignMember"("campaignId");
CREATE INDEX "CampaignMember_userId_idx" ON "CampaignMember"("userId");
CREATE INDEX "GameSession_roomId_idx" ON "GameSession"("roomId");
CREATE INDEX "GameSession_campaignId_idx" ON "GameSession"("campaignId");
CREATE INDEX "GameSession_startedAt_idx" ON "GameSession"("startedAt");
CREATE INDEX "Room_campaignId_idx" ON "Room"("campaignId");
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignMember" ADD CONSTRAINT "CampaignMember_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignMember" ADD CONSTRAINT "CampaignMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Room" ADD CONSTRAINT "Room_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
