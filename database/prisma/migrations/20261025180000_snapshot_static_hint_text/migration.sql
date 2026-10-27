-- Data-only migration: no schema change.
-- Static hints are now snapshotted into "hint_usages"."detail" at delivery, so a
-- later edit of the stage cannot rewrite what a student was shown. This fills the
-- snapshot for usages delivered before that change, from the text the stage holds
-- now (the best record available). Only rows with no detail are touched.
UPDATE "hint_usages" AS hu
SET "detail" = jsonb_build_object('hint', hs."content", 'source', 'static', 'backfilled', true)
FROM "hint_stages" AS hs
WHERE hu."hintStageId" = hs."id"
  AND hs."deliveryType" = 'STATIC'
  AND hu."status" = 'CONSUMED'
  AND hu."detail" IS NULL
  AND hs."content" IS NOT NULL
  AND length(trim(hs."content")) > 0;
