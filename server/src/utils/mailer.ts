import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

type Transport = (mail: Mail) => Promise<void>;

/** Sends through Resend's REST API (https://resend.com/docs/api-reference/emails/send-email). */
const resend: Transport = async (mail) => {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, ...mail }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Email provider rejected the message (${res.status})`);
};

/** Development without an email provider: print the message so the link can be opened locally. */
const devLog: Transport = async (mail) => {
  logger.info({ to: mail.to, subject: mail.subject }, `[dev email]\n${mail.text}`);
};

let transport: Transport = env.RESEND_API_KEY ? resend : devLog;

/** Email works with a provider, or in development via the log. Production needs a provider. */
export const emailEnabled = (): boolean => !!env.RESEND_API_KEY || env.NODE_ENV !== 'production';

export const sendMail = (mail: Mail): Promise<void> => transport(mail);

/** Test hook: capture outgoing mail instead of sending it. */
export function setMailTransportForTesting(fn: Transport): void {
  transport = fn;
}
