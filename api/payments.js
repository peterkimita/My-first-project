export const config = { api: { bodyParser: false } };

const MEMBERS = {
  "2782": { name: "Richard",     phone: "254718456514" },
  "4075": { name: "Chris",       phone: "254118569233" },
  "5510": { name: "Waigwa",      phone: "254723219321" },
  "004": { name: "Bonk",         phone: "254741325170" },
  "005": { name: "Peter",        phone: "254714082191" },
};

const seen = new Set();

async function sendSMS(phone, message) {
  const res = await fetch("https://bulksms.talksasa.com/api/v3/sms/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.TALK_SASA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: String(phone), sender_id: "PejaBeauty", type: "plain", message }),
  });
  console.log("SMS:", res.status, await res.text());
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  let raw = "";
  for await (const chunk of req) raw += chunk;
  let body;
  try { body = JSON.parse(raw); } catch { body = Object.fromEntries(new URLSearchParams(raw)); }

  const { TransID, TransAmount, FirstName, AccountReference, BillRefNumber } = body;
  const account = (AccountReference || BillRefNumber || "").trim();
  const member = MEMBERS[account];

  if (!member) return res.json({ ResultCode: "C2B00012", ResultDesc: "Invalid Account" });
  if (!TransID) return res.json({ ResultCode: "0", ResultDesc: "Accepted" });

  if (seen.has(TransID)) {
    console.log("DUPLICATE:", TransID);
    return res.json({ ResultCode: "0", ResultDesc: "Success" });
  }
  seen.add(TransID);

  try {
    const msg = `Dear ${member.name}, KES ${TransAmount} recd from ${FirstName || "Someone"}. Ref ${TransID}. Pay Paybill 4163519 Acct ${account}. God bless. Mlango Soko.`;
    await sendSMS(member.phone, msg);
    console.log("OK:", TransID, member.name);
  } catch (err) {
    console.error("SMS_ERR:", err.message);
  }

  return res.json({ ResultCode: "0", ResultDesc: "Success" });
}
