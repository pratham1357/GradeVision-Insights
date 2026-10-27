/**
 * @gradevision/database
 *
 * Prisma-backed data access for GradeVision Insights. Re-exports the generated
 * Prisma types/enums plus a shared PrismaClient singleton.
 */
export * from "@prisma/client";
export { prisma } from "./client.js";
export { prisma as default } from "./client.js";
export {
  checkDemoTarget,
  DEMO_SCOPE,
  inspectDemoData,
  resetDemoData,
  SEED_ID_PREFIX,
  serverDatabaseName,
  tsxScriptCommand,
  type DemoResetCounts,
  type DemoTargetCheck,
  type DemoTargetInput,
} from "./demo-reset.js";
