// Email-notification helper.
//
// Delivers lead/waitlist submissions to eran@bridgeops-engineering.com via
// Formsubmit.co — the same zero-backend relay the ContactForm already uses,
// so the destination email is already activated.
//
// To change destination, only update NOTIFY_ENDPOINT here.
// To harden (hide the email from client JS), replace with the hashed
// endpoint Formsubmit provides (https://formsubmit.co/ajax/<hashed-id>).

const NOTIFY_ENDPOINT = 'https://formsubmit.co/ajax/eran@bridgeops-engineering.com';

export interface NotifyPayload {
  subject: string;
  // Arbitrary key/value pairs included in the email body.
  // Formsubmit renders them as a table when _template is 'table'.
  fields: Record<string, string | number | boolean | null | undefined>;
  // Optional: address to reply to (usually the submitter's email).
  replyTo?: string;
}

export async function sendEmailNotification(payload: NotifyPayload): Promise<boolean> {
  const body: Record<string, unknown> = {
    _subject: payload.subject,
    _template: 'table',
    _captcha: 'false',
    ...payload.fields
  };
  if (payload.replyTo) {
    body._replyto = payload.replyTo;
  }

  try {
    const res = await fetch(NOTIFY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    // Formsubmit returns { success: "true" } on success.
    return !!data && (data.success === 'true' || data.success === true);
  } catch (err) {
    console.error('Email notification failed:', err);
    return false;
  }
}
