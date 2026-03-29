/**
 * Validate request data using a Zod schema.
 * @param {import("zod").ZodSchema} schema - Zod schema for validation.
 * @returns {import("express").RequestHandler} Express middleware.
 */
function validate(schema) {
  return (req, res, next) => {
    const data = {
      body: req.body || {},
      params: req.params || {},
      query: req.query || {}
    };

    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      return next(parsed.error);
    }

    req.body = parsed.data.body !== undefined ? parsed.data.body : req.body;
    req.params = parsed.data.params !== undefined ? parsed.data.params : req.params;
    req.query = parsed.data.query !== undefined ? parsed.data.query : req.query;
    return next();
  };
}

module.exports = validate;
