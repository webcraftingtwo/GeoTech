/**
 * Errors carry a machine code and a sentence a human can act on.
 *
 * "Something went wrong" is never an acceptable message in this system (§42) —
 * a technician who has just walked to a face deserves to know what happened to
 * their data and what happens next.
 */
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new ApiError(400, code, message, details);

export const unauthorized = (message = 'Sign in to continue.') =>
  new ApiError(401, 'auth.unauthorized', message);

export const forbidden = (message: string) => new ApiError(403, 'auth.forbidden', message);

export const notFound = (what: string) =>
  new ApiError(404, 'not_found', `${what} was not found.`);

export const conflict = (code: string, message: string, details?: unknown) =>
  new ApiError(409, code, message, details);
