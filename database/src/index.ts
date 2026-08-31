/**
 * @gradevision/database
 *
 * Prisma-backed data access for GradeVision Insights. Re-exports the generated
 * Prisma types/enums plus a shared PrismaClient singleton.
 */
export * from "@prisma/client";
export { prisma } from "./client.js";
export { prisma as default } from "./client.js";
