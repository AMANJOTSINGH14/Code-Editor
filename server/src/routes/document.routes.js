const express = require("express");
const { z } = require("zod");
const authenticate = require("../middleware/auth");
const validate = require("../middleware/validate");
const { create, list, get, contributors, update, remove } = require("../controllers/document.controller");

const router = express.Router();

router.use(authenticate);

const createSchema = z.object({
  body: z.object({
    title: z.string().min(1),
    language: z.string().min(1).optional(),
    isPublic: z.boolean().optional()
  }),
  params: z.object({}),
  query: z.object({})
});

const updateSchema = z.object({
  body: z.object({
    title: z.string().min(1).optional(),
    language: z.string().min(1).optional(),
    isPublic: z.boolean().optional()
  }),
  params: z.object({
    id: z.string().min(1)
  }),
  query: z.object({})
});

const idSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({
    id: z.string().min(1)
  }),
  query: z.object({})
});

router.post("/", validate(createSchema), create);
router.get("/", list);
router.get("/:id/contributors", validate(idSchema), contributors);
router.get("/:id", validate(idSchema), get);
router.patch("/:id", validate(updateSchema), update);
router.delete("/:id", validate(idSchema), remove);

module.exports = router;
