export class ValidationError extends Error {
  constructor(details) {
    super('Dados inválidos.');
    this.name = 'ValidationError';
    this.status = 400;
    this.expose = true;
    this.details = details;
  }
}

/** Valida o corpo com um schema zod e devolve os dados já tipados. */
export function parseBody(schema, body) {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((issue) => issue.message));
  }
  return result.data;
}

/** Encaminha erros de handlers async para o errorHandler do Express. */
export const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};
