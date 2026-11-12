export function pushConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  const validSubject = Boolean(subject && (/^mailto:[^\s@]+@[^\s@]+$/.test(subject) || /^https:\/\/[^\s]+$/.test(subject)));
  const configured = Boolean(publicKey && /^[A-Za-z0-9_-]{87}$/.test(publicKey) && privateKey && /^[A-Za-z0-9_-]{43}$/.test(privateKey) && validSubject);
  return { enabled: process.env.PUSH_ENABLED === 'true' && configured, publicKey: configured ? publicKey! : null,
    vapidDetails: configured ? { subject: subject!, publicKey: publicKey!, privateKey: privateKey! } : null };
}
