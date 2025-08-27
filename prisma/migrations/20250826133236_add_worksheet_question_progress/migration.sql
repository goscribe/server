-- AlterTable
ALTER TABLE "public"."Artifact" ADD COLUMN     "description" TEXT;

-- CreateTable
CREATE TABLE "public"."WorksheetQuestionProgress" (
    "id" TEXT NOT NULL,
    "worksheetQuestionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "userAnswer" TEXT,
    "completedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "timeSpentSec" INTEGER,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorksheetQuestionProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorksheetQuestionProgress_userId_idx" ON "public"."WorksheetQuestionProgress"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorksheetQuestionProgress_worksheetQuestionId_userId_key" ON "public"."WorksheetQuestionProgress"("worksheetQuestionId", "userId");

-- AddForeignKey
ALTER TABLE "public"."WorksheetQuestionProgress" ADD CONSTRAINT "WorksheetQuestionProgress_worksheetQuestionId_fkey" FOREIGN KEY ("worksheetQuestionId") REFERENCES "public"."WorksheetQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WorksheetQuestionProgress" ADD CONSTRAINT "WorksheetQuestionProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
