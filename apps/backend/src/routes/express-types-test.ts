import { Router, Request, Response, NextFunction } from 'express';

const router: Router = Router();

router.get('/test', (req: Request, res: Response, next: NextFunction) => {
  res.json({ message: 'Express types are working', body: req.body, params: req.params });
  next();
});

export default router;
