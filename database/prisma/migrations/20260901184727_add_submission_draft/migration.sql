-- CreateTable
CREATE TABLE "submission_drafts" (
    "id" UUID NOT NULL,
    "examSessionId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "language" "ProgrammingLanguage" NOT NULL,
    "sourceCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "submission_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "submission_drafts_examSessionId_idx" ON "submission_drafts"("examSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "submission_drafts_examSessionId_questionId_key" ON "submission_drafts"("examSessionId", "questionId");

-- AddForeignKey
ALTER TABLE "submission_drafts" ADD CONSTRAINT "submission_drafts_examSessionId_fkey" FOREIGN KEY ("examSessionId") REFERENCES "exam_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_drafts" ADD CONSTRAINT "submission_drafts_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
