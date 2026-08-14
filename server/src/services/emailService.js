const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM   = 'ChessLens <onboarding@resend.dev>';

const wrap = (body) => `
  <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:36px 28px;background:#0d1117;color:#e6edf3;border-radius:12px;border:1px solid #21262d">
    <p style="font-size:1.6rem;margin:0 0 4px">♟</p>
    <h1 style="font-size:1.2rem;margin:0 0 20px;color:#e6edf3">ChessLens</h1>
    ${body}
    <p style="color:#484f58;font-size:0.75rem;margin-top:32px;border-top:1px solid #21262d;padding-top:16px">
      You received this email because an action was taken on your ChessLens account.
    </p>
  </div>`;

const btn = (url, label) =>
  `<a href="${url}" style="display:inline-block;padding:12px 26px;background:#238636;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;font-size:0.9rem">${label}</a>`;

const muted = (text) => `<p style="color:#8b949e;font-size:0.8rem;margin-top:20px;line-height:1.6">${text}</p>`;

exports.sendVerificationEmail = async (to, token) => {
  const url = `${process.env.CLIENT_URL}/verify-email?token=${token}`;
  if (!resend) {
    console.log(`[Dev] Verification link for ${to}: ${url}`);
    return;
  }
  await resend.emails.send({
    from: FROM, to,
    subject: 'Verify your ChessLens account',
    html: wrap(`
      <p style="color:#8b949e;margin-bottom:28px">Welcome aboard! Click the button below to verify your email and activate your account.</p>
      ${btn(url, 'Verify Email')}
      ${muted(`Or copy this link: <a href="${url}" style="color:#58a6ff">${url}</a><br>This link expires in 24 hours.`)}
    `)
  });
};

exports.sendPasswordResetEmail = async (to, token) => {
  const url = `${process.env.CLIENT_URL}/reset-password?token=${token}`;
  if (!resend) {
    console.log(`[Dev] Password reset link for ${to}: ${url}`);
    return;
  }
  await resend.emails.send({
    from: FROM, to,
    subject: 'Reset your ChessLens password',
    html: wrap(`
      <p style="color:#8b949e;margin-bottom:28px">Someone requested a password reset for your account. Click below to set a new password.</p>
      ${btn(url, 'Reset Password')}
      ${muted(`Or copy this link: <a href="${url}" style="color:#58a6ff">${url}</a><br>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.`)}
    `)
  });
};
