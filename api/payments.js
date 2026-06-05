// ============================================================
// MLANGO SOKO — DARAJA PAYMENT HANDLER + SMS TEST
// ============================================================
// Paybill: 4189239
// This file does two things:
//   1. Listens for M-PESA payments and sends SMS to the member
//   2. Has a test endpoint: GET /api/payments?test=1
//
// ENVIRONMENT VARIABLES needed in Vercel:
//   TALKSASA_SECRET = your Talksasa API token
// ============================================================

export const config = { api: { bodyParser: false } };

// ── MEMBER LOOKUP TABLE ──────────────────────────────────────
// Maps account numbers to member names and phone numbers.
const MEMBERS = {
  "001": { name: "Richard", phone: "254113794559" },
  "002": { name: "Chris",   phone: "254118569233" },
  "003": { name: "Waigwa",  phone: "254751633623" },
  "004": { name: "Bonk",    phone: "254741325170" },
  "005": { name: "Peter",   phone: "254714082191" },
};

// ── FORMAT DATE ───────────────────────────────────────────────
function formatDateTime(transTime) {
  try {
    const s = String(transTime);
    return `${s.slice(6,8)}/${s.slice(4,6)}/${s.slice(0,4)} ${s.slice(8,10)}:${s.slice(10,12)}`;
  } catch { return String(transTime); }
}

// ── SEND SMS ──────────────────────────────────────────────────
async function sendSMS(to, message) {
  console.log(`📱 Sending SMS to ${to}: ${message}`);
  const r = await fetch("https://bulksms.talksasa.com/api/v3/sms/send", {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${process.env.TALKSASA_SECRET}`,
    },
    body: JSON.stringify({
      recipient: to,
      sender_id: "MlangoSoko",
      message,
      type: "plain",
    }),
  });
  const result = await r.json();
  console.log("📱 SMS Result:", JSON.stringify(result));
  return result;
}

// ── MAIN HANDLER ─────────────────────────────────────────────
export default async function handler(req, res) {

  // ── TEST ENDPOINT ─────────────────────────────────────────
  // Visit: https://yoursite.vercel.app/api/payments?test=1
  // This sends a test SMS to all 5 members so you can verify
  // Talksasa is working before going live with Safaricom.
  if (req.method === "GET") {
    const url = new URL(req.url, `https://${req.headers.host}`);
    if (url.searchParams.get("test") === "1") {
      console.log("🧪 Running SMS test...");
      const results = [];
      for (const [acct, member] of Object.entries(MEMBERS)) {
        const msg = `Dear ${member.name}, this is a test message from Mlango Soko. Your account number is ${acct}. Paybill: 4189239.`;
        try {
          const r = await sendSMS(member.phone, msg);
          results.push({ account: acct, name: member.name, phone: member.phone, result: r });
        } catch(e) {
          results.push({ account: acct, name: member.name, phone: member.phone, error: e.message });
        }
      }
      return res.status(200).json({ test: true, results });
    }
    return res.status(200).json({ status: "Mlango Soko Payment Handler running", paybill: "4189239" });
  }

  // Only accept POST from Safaricom
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Read raw body
  let rawBody = "";
  for await (const chunk of req) rawBody += chunk;

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    body = Object.fromEntries(new URLSearchParams(rawBody));
  }

  console.log("🔥 Daraja Payload:", JSON.stringify(body, null, 2));

  const {
    TransID,
    TransAmount,
    TransTime,
    FirstName,
    LastName,
    BillRefNumber,
    AccountReference,
  } = body;

  const account = (AccountReference || BillRefNumber || "").trim().padStart(3, "0");

  // ── VALIDATION ────────────────────────────────────────────
  if (!TransID) {
    console.log(`🔍 Validation for account: ${account}`);
    const member = MEMBERS[account];
    if (!member) {
      console.log(`❌ Unknown account: ${account}`);
      return res.json({ ResultCode: "C2B00012", ResultDesc: "Invalid Account Number" });
    }
    console.log(`✅ Valid: ${account} (${member.name})`);
    return res.json({ ResultCode: "0", ResultDesc: "Accepted" });
  }

  // ── CONFIRMATION ──────────────────────────────────────────
  const member = MEMBERS[account];
  if (!member) {
    console.log(`❌ No member for account: ${account}`);
    return res.json({ ResultCode: "C2B00012", ResultDesc: "Invalid Account" });
  }

  const amount  = parseFloat(TransAmount).toFixed(2);
  const dateStr = formatDateTime(TransTime);

  const senderFirst = (FirstName || "").charAt(0).toUpperCase() + (FirstName || "").slice(1).toLowerCase();
  const senderLast  = (LastName  || "").charAt(0).toUpperCase() + (LastName  || "").slice(1).toLowerCase();
  const senderName  = [senderFirst, senderLast].filter(Boolean).join(" ") || "Someone";

  // SMS format: "Dear Richard, Mary has sent KES 10 into your account number 001. Mpesa mali yake. Trans ID: ..."
  const message =
    `Dear ${member.name}, ` +
    `${senderName} has sent KES ${amount} into your account number ${account}. ` +
    `Mpesa mali yake. ` +
    `Trans ID: ${TransID}. ` +
    `Date: ${dateStr}.`;

  try {
    await sendSMS(member.phone, message);
    console.log(`✅ SMS sent to ${member.name}`);
  } catch(err) {
    console.error("SMS failed:", err.message);
  }

  return res.json({ ResultCode: "0", ResultDesc: "Success" });
}
