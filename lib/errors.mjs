export class AppError extends Error {
  constructor(status, message, details = undefined) {
    super(message); this.name = 'AppError'; this.status = status; this.details = details;
  }
}
export function ensure(condition, status, message, details) {
  if (!condition) throw new AppError(status, message, details);
}
