import { Resend } from "resend";
import { logger } from "./logger";

let resendClient: Resend | null = null;

function getResendClient(): Resend | null {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) return null;
  if (!resendClient) {
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

const FROM_EMAIL = process.env["EMAIL_FROM"] || "Ticker <noreply@ticker.app>";

export async function sendPasswordResetEmail(opts: {
  to: string;
  resetUrl: string;
}): Promise<void> {
  const client = getResendClient();

  if (!client) {
    logger.warn(
      { to: opts.to },
      "RESEND_API_KEY not configured — skipping password reset email",
    );
    return;
  }

  try {
    await client.emails.send({
      from: FROM_EMAIL,
      to: opts.to,
      subject: "Reset your Ticker password",
      html: `
        <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
          <h2 style="color: #111;">Reset your password</h2>
          <p>We received a request to reset the password for your Ticker account.</p>
          <p>Click the button below to set a new password. This link expires in 1 hour.</p>
          <a href="${opts.resetUrl}"
             style="display: inline-block; padding: 12px 24px; background: #111; color: #fff;
                    text-decoration: none; border-radius: 6px; font-weight: 600;">
            Reset Password
          </a>
          <p style="color: #666; font-size: 13px; margin-top: 24px;">
            If you didn't request this, you can safely ignore this email.
            Your password will not change.
          </p>
        </div>
      `,
      text: `Reset your Ticker password\n\nClick this link to reset your password (expires in 1 hour):\n${opts.resetUrl}\n\nIf you didn't request this, you can ignore this email.`,
    });
    logger.info({ to: opts.to }, "Password reset email sent");
  } catch (err) {
    logger.error({ err, to: opts.to }, "Failed to send password reset email");
    throw err;
  }
}
