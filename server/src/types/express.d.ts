import 'express-session';
import type { Types } from 'mongoose';

export type OrgRole = 'ADMIN' | 'MEMBER';

export interface AuthContext {
  userId: Types.ObjectId;
  organizationId: Types.ObjectId;
  role: OrgRole;
  email: string;
  name: string;
}

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    organizationId?: string;
    csrfToken?: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      id?: string;
    }
  }
}
