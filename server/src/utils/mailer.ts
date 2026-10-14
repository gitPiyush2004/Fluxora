import { env } from '../config/env.js';

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

let transport: Transport = resend;

/** Email sign-in is offered only when an email provider is configured (it needs a verified domain). */
export const emailEnabled = (): boolean => !!env.RESEND_API_KEY;

export const sendMail = (mail: Mail): Promise<void> => transport(mail);

/** Test hook: capture outgoing mail instead of sending it. */
export function setMailTransportForTesting(fn: Transport): void {
  transport = fn;
}
