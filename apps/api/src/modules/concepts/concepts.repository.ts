import { prisma } from "../../services/database.js";

/** Every concept, alphabetical - the vocabulary an instructor picks from. */
export function listConcepts() {
  return prisma.concept.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, description: true },
  });
}

/** The subset of `ids` that exist, for validating client-supplied concept ids. */
export function findExistingConceptIds(ids: string[]): Promise<{ id: string }[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return prisma.concept.findMany({ where: { id: { in: ids } }, select: { id: true } });
}
