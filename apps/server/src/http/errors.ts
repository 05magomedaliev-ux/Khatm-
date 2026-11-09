import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const forbidden = (message = 'У вас нет доступа к этому разделу.') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Запись не найдена.') => new HttpError(404, 'not_found', message);
export const invalid = (message: string, code = 'invalid_input') => new HttpError(422, code, message);

export function handle(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

export function errorMiddleware(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details } });
    return;
  }
  if (error instanceof ZodError) {
    res.status(422).json({ error: { code: 'invalid_input', message: error.issues[0]?.message ?? 'Проверьте введённые данные.' } });
    return;
  }
  if (error instanceof SyntaxError) {
    res.status(400).json({ error: { code: 'bad_json', message: 'Некорректный формат запроса.' } });
    return;
  }
  const maybeTooLarge = error as { type?: string };
  if (maybeTooLarge?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'too_large', message: 'Файл слишком большой.' } });
    return;
  }
  console.error(error);
  res.status(500).json({ error: { code: 'server_error', message: 'На сервере произошла ошибка. Попробуйте ещё раз.' } });
}
