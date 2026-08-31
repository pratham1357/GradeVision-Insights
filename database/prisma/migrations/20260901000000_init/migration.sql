-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('STUDENT', 'INSTRUCTOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'DROPPED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "QuestionDifficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateEnum
CREATE TYPE "ProgrammingLanguage" AS ENUM ('C', 'CPP', 'JAVA', 'PYTHON', 'JAVASCRIPT');

-- CreateEnum
CREATE TYPE "TestCaseVisibility" AS ENUM ('VISIBLE', 'HIDDEN');

-- CreateEnum
CREATE TYPE "TestCaseCategory" AS ENUM ('STANDARD', 'SAMPLE', 'EDGE', 'PERFORMANCE', 'STRESS');

-- CreateEnum
CREATE TYPE "RubricCriterionType" AS ENUM ('FUNCTIONAL_CORRECTNESS', 'SEMANTIC_CORRECTNESS', 'ALGORITHMIC_APPROACH', 'PERFORMANCE', 'CODE_QUALITY', 'OTHER');

-- CreateEnum
CREATE TYPE "ExamSessionStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'EXPIRED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "EvaluationRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TestCaseResultStatus" AS ENUM ('PASSED', 'FAILED', 'ERROR', 'TIMEOUT', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ViolationType" AS ENUM ('TAB_SWITCH', 'WINDOW_BLUR', 'FULLSCREEN_EXIT', 'VISIBILITY_CHANGE', 'OTHER');

-- CreateEnum
CREATE TYPE "ViolationSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "HintDeliveryType" AS ENUM ('STATIC', 'INTERACTIVE');

-- CreateEnum
CREATE TYPE "HintUsageStatus" AS ENUM ('REQUESTED', 'UNLOCKED', 'CONSUMED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'STUDENT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sections" (
    "id" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "term" TEXT,
    "year" INTEGER,
    "instructorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "sectionId" UUID NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessments" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "courseId" UUID,
    "sectionId" UUID,
    "createdById" UUID NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "durationMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_questions" (
    "id" UUID NOT NULL,
    "assessmentId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "points" DECIMAL(6,2) NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "constraints" TEXT,
    "inputFormat" TEXT,
    "outputFormat" TEXT,
    "difficulty" "QuestionDifficulty" NOT NULL DEFAULT 'MEDIUM',
    "timeLimitMs" INTEGER,
    "memoryLimitMb" INTEGER,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_languages" (
    "id" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "language" "ProgrammingLanguage" NOT NULL,
    "starterCode" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "question_languages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_cases" (
    "id" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "name" TEXT,
    "input" TEXT NOT NULL,
    "expectedOutput" TEXT NOT NULL,
    "visibility" "TestCaseVisibility" NOT NULL DEFAULT 'HIDDEN',
    "category" "TestCaseCategory" NOT NULL DEFAULT 'STANDARD',
    "weight" DECIMAL(6,2) NOT NULL DEFAULT 1,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rubrics" (
    "id" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rubrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rubric_criteria" (
    "id" UUID NOT NULL,
    "rubricId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "RubricCriterionType" NOT NULL,
    "maxPoints" DECIMAL(6,2) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rubric_criteria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_sessions" (
    "id" UUID NOT NULL,
    "assessmentId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "status" "ExamSessionStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" UUID NOT NULL,
    "examSessionId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "language" "ProgrammingLanguage" NOT NULL,
    "sourceCode" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'QUEUED',
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_runs" (
    "id" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "runNumber" INTEGER NOT NULL DEFAULT 1,
    "status" "EvaluationRunStatus" NOT NULL DEFAULT 'PENDING',
    "totalScore" DECIMAL(8,2),
    "maxScore" DECIMAL(8,2),
    "executionTimeMs" INTEGER,
    "memoryKb" INTEGER,
    "runtimeInfo" TEXT,
    "errorType" TEXT,
    "errorMessage" TEXT,
    "providerMetadata" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evaluation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_case_results" (
    "id" UUID NOT NULL,
    "evaluationRunId" UUID NOT NULL,
    "testCaseId" UUID NOT NULL,
    "status" "TestCaseResultStatus" NOT NULL,
    "pointsAwarded" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "pointsPossible" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "executionTimeMs" INTEGER,
    "memoryKb" INTEGER,
    "stdout" TEXT,
    "stderr" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_case_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "criterion_scores" (
    "id" UUID NOT NULL,
    "evaluationRunId" UUID NOT NULL,
    "rubricCriterionId" UUID NOT NULL,
    "pointsAwarded" DECIMAL(6,2) NOT NULL,
    "maxPoints" DECIMAL(6,2) NOT NULL,
    "notes" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "criterion_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "violations" (
    "id" UUID NOT NULL,
    "examSessionId" UUID NOT NULL,
    "type" "ViolationType" NOT NULL,
    "severity" "ViolationSeverity" NOT NULL DEFAULT 'LOW',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detail" JSONB,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "violations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hint_stages" (
    "id" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "stageNumber" INTEGER NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "deliveryType" "HintDeliveryType" NOT NULL DEFAULT 'STATIC',
    "unlockDelaySeconds" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hint_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hint_usages" (
    "id" UUID NOT NULL,
    "hintStageId" UUID NOT NULL,
    "examSessionId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "status" "HintUsageStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlockedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hint_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "summary" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "courses_code_key" ON "courses"("code");

-- CreateIndex
CREATE INDEX "sections_courseId_idx" ON "sections"("courseId");

-- CreateIndex
CREATE INDEX "sections_instructorId_idx" ON "sections"("instructorId");

-- CreateIndex
CREATE UNIQUE INDEX "sections_courseId_name_key" ON "sections"("courseId", "name");

-- CreateIndex
CREATE INDEX "enrollments_sectionId_idx" ON "enrollments"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_studentId_sectionId_key" ON "enrollments"("studentId", "sectionId");

-- CreateIndex
CREATE INDEX "assessments_status_idx" ON "assessments"("status");

-- CreateIndex
CREATE INDEX "assessments_status_startsAt_idx" ON "assessments"("status", "startsAt");

-- CreateIndex
CREATE INDEX "assessments_startsAt_endsAt_idx" ON "assessments"("startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "assessments_courseId_idx" ON "assessments"("courseId");

-- CreateIndex
CREATE INDEX "assessments_sectionId_idx" ON "assessments"("sectionId");

-- CreateIndex
CREATE INDEX "assessment_questions_questionId_idx" ON "assessment_questions"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_questions_assessmentId_questionId_key" ON "assessment_questions"("assessmentId", "questionId");

-- CreateIndex
CREATE INDEX "questions_difficulty_idx" ON "questions"("difficulty");

-- CreateIndex
CREATE INDEX "questions_isArchived_idx" ON "questions"("isArchived");

-- CreateIndex
CREATE UNIQUE INDEX "question_languages_questionId_language_key" ON "question_languages"("questionId", "language");

-- CreateIndex
CREATE INDEX "test_cases_questionId_visibility_idx" ON "test_cases"("questionId", "visibility");

-- CreateIndex
CREATE INDEX "test_cases_questionId_position_idx" ON "test_cases"("questionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "rubrics_questionId_key" ON "rubrics"("questionId");

-- CreateIndex
CREATE INDEX "rubric_criteria_rubricId_idx" ON "rubric_criteria"("rubricId");

-- CreateIndex
CREATE INDEX "rubric_criteria_type_idx" ON "rubric_criteria"("type");

-- CreateIndex
CREATE INDEX "exam_sessions_studentId_assessmentId_idx" ON "exam_sessions"("studentId", "assessmentId");

-- CreateIndex
CREATE INDEX "exam_sessions_assessmentId_status_idx" ON "exam_sessions"("assessmentId", "status");

-- CreateIndex
CREATE INDEX "exam_sessions_status_expiresAt_idx" ON "exam_sessions"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "exam_sessions_assessmentId_studentId_attemptNumber_key" ON "exam_sessions"("assessmentId", "studentId", "attemptNumber");

-- CreateIndex
CREATE INDEX "submissions_examSessionId_questionId_idx" ON "submissions"("examSessionId", "questionId");

-- CreateIndex
CREATE INDEX "submissions_status_idx" ON "submissions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_examSessionId_questionId_attemptNumber_key" ON "submissions"("examSessionId", "questionId", "attemptNumber");

-- CreateIndex
CREATE INDEX "evaluation_runs_submissionId_idx" ON "evaluation_runs"("submissionId");

-- CreateIndex
CREATE INDEX "evaluation_runs_status_idx" ON "evaluation_runs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_runs_submissionId_runNumber_key" ON "evaluation_runs"("submissionId", "runNumber");

-- CreateIndex
CREATE INDEX "test_case_results_evaluationRunId_idx" ON "test_case_results"("evaluationRunId");

-- CreateIndex
CREATE INDEX "test_case_results_testCaseId_idx" ON "test_case_results"("testCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "test_case_results_evaluationRunId_testCaseId_key" ON "test_case_results"("evaluationRunId", "testCaseId");

-- CreateIndex
CREATE INDEX "criterion_scores_evaluationRunId_idx" ON "criterion_scores"("evaluationRunId");

-- CreateIndex
CREATE UNIQUE INDEX "criterion_scores_evaluationRunId_rubricCriterionId_key" ON "criterion_scores"("evaluationRunId", "rubricCriterionId");

-- CreateIndex
CREATE INDEX "violations_examSessionId_occurredAt_idx" ON "violations"("examSessionId", "occurredAt");

-- CreateIndex
CREATE INDEX "violations_type_idx" ON "violations"("type");

-- CreateIndex
CREATE INDEX "hint_stages_questionId_idx" ON "hint_stages"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "hint_stages_questionId_stageNumber_key" ON "hint_stages"("questionId", "stageNumber");

-- CreateIndex
CREATE INDEX "hint_usages_examSessionId_questionId_idx" ON "hint_usages"("examSessionId", "questionId");

-- CreateIndex
CREATE INDEX "hint_usages_studentId_idx" ON "hint_usages"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "hint_usages_examSessionId_hintStageId_key" ON "hint_usages"("examSessionId", "hintStageId");

-- CreateIndex
CREATE INDEX "audit_events_actorId_idx" ON "audit_events"("actorId");

-- CreateIndex
CREATE INDEX "audit_events_entityType_entityId_idx" ON "audit_events"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_events_action_idx" ON "audit_events"("action");

-- CreateIndex
CREATE INDEX "audit_events_createdAt_idx" ON "audit_events"("createdAt");

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_questions" ADD CONSTRAINT "assessment_questions_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_questions" ADD CONSTRAINT "assessment_questions_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_languages" ADD CONSTRAINT "question_languages_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rubrics" ADD CONSTRAINT "rubrics_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rubric_criteria" ADD CONSTRAINT "rubric_criteria_rubricId_fkey" FOREIGN KEY ("rubricId") REFERENCES "rubrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_examSessionId_fkey" FOREIGN KEY ("examSessionId") REFERENCES "exam_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_case_results" ADD CONSTRAINT "test_case_results_evaluationRunId_fkey" FOREIGN KEY ("evaluationRunId") REFERENCES "evaluation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_case_results" ADD CONSTRAINT "test_case_results_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "test_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "criterion_scores" ADD CONSTRAINT "criterion_scores_evaluationRunId_fkey" FOREIGN KEY ("evaluationRunId") REFERENCES "evaluation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "criterion_scores" ADD CONSTRAINT "criterion_scores_rubricCriterionId_fkey" FOREIGN KEY ("rubricCriterionId") REFERENCES "rubric_criteria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "violations" ADD CONSTRAINT "violations_examSessionId_fkey" FOREIGN KEY ("examSessionId") REFERENCES "exam_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "violations" ADD CONSTRAINT "violations_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hint_stages" ADD CONSTRAINT "hint_stages_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hint_usages" ADD CONSTRAINT "hint_usages_hintStageId_fkey" FOREIGN KEY ("hintStageId") REFERENCES "hint_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hint_usages" ADD CONSTRAINT "hint_usages_examSessionId_fkey" FOREIGN KEY ("examSessionId") REFERENCES "exam_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hint_usages" ADD CONSTRAINT "hint_usages_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hint_usages" ADD CONSTRAINT "hint_usages_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

