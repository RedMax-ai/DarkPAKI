/**
 * Generic Zod validation middleware factory.
 *
 * Usage:
 *   router.post('/endpoint', validate(myZodSchema), controller);
 *
 * Validates req.body against the provided schema.
 * On failure, returns 400 with sanitised field-level error messages.
 */
const { ZodError } = require('zod');

/**
 * @param {import('zod').ZodSchema} schema
 * @returns {import('express').RequestHandler}
 */
function validate(schema) {
  return (req, res, next) => {
    try {
      /* parseSync throws on failure */
      req.body = schema.parse(req.body);
      return next();
    } catch (err) {
      if (err instanceof ZodError) {
        const messages = err.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        return res.status(400).json({ error: 'Validation failed.', details: messages });
      }
      /* Not a Zod error — hand off to the global error handler */
      return next(err);
    }
  };
}

module.exports = { validate };
