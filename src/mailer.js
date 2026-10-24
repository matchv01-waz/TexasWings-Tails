'use strict';
// Optional email alerts for new contact-form messages. Only active when SMTP
// settings are provided in the environment (see README). Messages are always
// saved in the admin Inquiries list regardless.

let transport = null;
function getTransport() {
  if (!process.env.SMTP_HOST) return null;
  if (!transport) {
    transport = require('nodemailer').createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      // The contact form waits for the alert, so give up quickly if the mail server is slow.
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 7000,
    });
  }
  return transport;
}

async function notifyInquiry(to, inquiry, siteName) {
  const t = getTransport();
  if (!t || !to) return;
  const lines = [
    `Name: ${inquiry.name}`,
    `Email: ${inquiry.email}`,
    inquiry.phone && `Phone: ${inquiry.phone}`,
    inquiry.whatsapp && `WhatsApp: ${inquiry.whatsapp}`,
    inquiry.interest && `Interested in: ${inquiry.interest}`,
    '',
    inquiry.message,
  ].filter((l) => typeof l === 'string');
  // Send from our own address (Gmail won't send as the visitor) but show the visitor's name.
  const fromSetting = process.env.SMTP_FROM || process.env.SMTP_USER;
  const fromAddress = (fromSetting.match(/<([^>]+)>/) || [])[1] || fromSetting;
  await t.sendMail({
    from: { name: `${inquiry.name} via ${siteName}`, address: fromAddress },
    to,
    replyTo: inquiry.email,
    subject: `New message from ${inquiry.name} — ${siteName}`,
    text: lines.join('\n'),
  });
}

module.exports = { notifyInquiry };
