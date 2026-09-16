import { Resend } from "resend";
import { PublicAccessError } from "./rate-limit.js";
export interface EmailPort {
  sendOtp(input: { to: string; code: string; requestId: string }): Promise<{ accepted: boolean; messageId?: string }>;
}
export const resendEmailAdapter: EmailPort = {
  async sendOtp({ to, code, requestId }) {
    const key = process.env.RESEND_API_KEY, from = process.env.EMAIL_FROM;
    // Resend enforces domain verification server-side. Never use its owner-only test domain.
    if (!key || !from || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(from) || /@(?:.*\.)?resend\.dev$/i.test(from)) {
      throw new PublicAccessError("EMAIL_UNAVAILABLE", "Email delivery temporarily unavailable. Please try again later.", 503);
    }
    const resend = new Resend(key);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        resend.emails.send({ from, to, subject: "Your Cashback Hub verification code", text: `Your verification code is ${code}. It expires shortly. Never share this code. If you did not request it, ignore this email.` }, { idempotencyKey: requestId }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("EMAIL_TIMEOUT")), 10000); })
      ]);
      if (result.error || !result.data?.id) return { accepted: false };
      return { accepted: true, messageId: result.data.id };
    } finally { if (timer) clearTimeout(timer); }
  }
};
