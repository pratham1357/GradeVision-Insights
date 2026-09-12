-- CreateTable
CREATE TABLE "concepts" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "concepts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_concepts" (
    "id" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "conceptId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_concepts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "concepts_name_key" ON "concepts"("name");

-- CreateIndex
CREATE INDEX "question_concepts_conceptId_idx" ON "question_concepts"("conceptId");

-- CreateIndex
CREATE UNIQUE INDEX "question_concepts_questionId_conceptId_key" ON "question_concepts"("questionId", "conceptId");

-- AddForeignKey
ALTER TABLE "question_concepts" ADD CONSTRAINT "question_concepts_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_concepts" ADD CONSTRAINT "question_concepts_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concepts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
