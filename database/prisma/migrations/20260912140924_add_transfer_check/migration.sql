-- AlterTable
ALTER TABLE "questions" ADD COLUMN     "transferQuestionId" UUID;

-- AlterTable
ALTER TABLE "submissions" ADD COLUMN     "transferSourceQuestionId" UUID;

-- CreateIndex
CREATE INDEX "questions_transferQuestionId_idx" ON "questions"("transferQuestionId");

-- CreateIndex
CREATE INDEX "submissions_examSessionId_transferSourceQuestionId_idx" ON "submissions"("examSessionId", "transferSourceQuestionId");

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_transferQuestionId_fkey" FOREIGN KEY ("transferQuestionId") REFERENCES "questions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_transferSourceQuestionId_fkey" FOREIGN KEY ("transferSourceQuestionId") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
