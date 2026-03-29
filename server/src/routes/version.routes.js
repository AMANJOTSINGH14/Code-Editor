const express = require("express");
const { z } = require("zod");
const authenticate = require("../middleware/auth");
const validate = require("../middleware/validate");
const { create, list, get, restore, remove } = require("../controllers/version.controller");

const router = express.Router({ mergeParams: true });

router.use(authenticate);

const createSchema = z.object({
  body: z.object({
    label: z.string().max(120).optional()
  }),
  params: z.object({
    id: z.string().min(1)
  }),
  query: z.object({})
});

const listSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({
    id: z.string().min(1)
  }),
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional()
  })
});

const versionSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({
    id: z.string().min(1),
    versionId: z.string().min(1)
  }),
  query: z.object({})
});

router.post("/", validate(createSchema), create);
router.get("/", validate(listSchema), list);
router.get("/:versionId", validate(versionSchema), get);
router.post("/:versionId/restore", validate(versionSchema), restore);
router.delete("/:versionId", validate(versionSchema), remove);

module.exports = router;
