import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';

const REQUEST_ID_HEADER = 'x-request-id';

export const attachRequestId = (req: Request, res: Response, next: NextFunction) => {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const requestId =
    (typeof incoming === 'string' && incoming.trim()) ||
    (Array.isArray(incoming) && incoming[0]) ||
    randomUUID();

  (req as any).requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
};

