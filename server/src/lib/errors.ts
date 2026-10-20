export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const badRequest = (code: string, message: string) => new HttpError(400, code, message);
export const unauthorized = (message = "Anmeldung erforderlich") => new HttpError(401, "unauthorized", message);
export const forbidden = (message = "Keine Berechtigung") => new HttpError(403, "forbidden", message);
export const notFound = (what = "Eintrag") => new HttpError(404, "not_found", `${what} nicht gefunden`);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);
