import type { ConceptDto } from "@gradevision/shared";
import type { Request, Response } from "express";

import { sendData } from "../../utils/http.js";
import { listConcepts } from "./concepts.repository.js";

/** `GET /api/v1/concepts` - the concept vocabulary (read-only in this phase). */
export async function getConcepts(_req: Request, res: Response): Promise<void> {
  const rows = await listConcepts();
  const concepts: ConceptDto[] = rows.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
  }));
  sendData(res, concepts);
}
