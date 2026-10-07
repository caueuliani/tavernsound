CREATE TABLE "TestBudget" (
    "id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "operations" INTEGER NOT NULL DEFAULT 0,
    "reservedMinutes" INTEGER NOT NULL DEFAULT 0,
    "roomId" TEXT,
    "endsAt" TIMESTAMP(3),
    "participants" JSONB NOT NULL DEFAULT '[]',
    CONSTRAINT "TestBudget_pkey" PRIMARY KEY ("id")
);
