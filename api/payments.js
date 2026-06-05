// app/api/payments/route.js  (Next.js App Router)

const MEMBERS = {
  "001": { name: "Richard", phone: "254113794559" },
  "002": { name: "Chris",   phone: "254118569233" },
  "003": { name: "Waigwa", phone: "254751633623" },
  "004": { name: "Bonk",   phone: "254741325170" },
  "005": { name: "Peter",  phone: "254714082191" },
};

async function sendSMS(phone, message) {
  const token = process.env.TALK_SASA_TOKEN;
  const payload = {
    recipient: String(phone),
    sender_id: "PejaBeauty",
    type: "plain",
    message,
  };

  console.log("SMS_TOKEN_EXISTS:", !!token);
  console.log("SMS_TOKEN_PREVIEW:", token ? token.slice(0, 8) + "..." : "MISSING");
  console.log("SMS_PAYLOAD:", JSON.stringify(payload));

  const res = await fetch("https://bulksms.talksasa.com/api/v3/sms/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  console.log("SMS_HTTP_STATUS:", res.status);
  const raw = await res.text();
  console.log("SMS_RAW_RESPONSE:", raw);
}

export async function POST(req) {
  const raw = await req.text();
  console.log("RAW_BODY:", raw);

  let body;
  try { body = JSON.parse(raw); }
  catch { body = Object.fromEntries(new URLSearchParams(raw)); }

  console.log("PARSED_BODY:", JSON.stringify(body));

  const { TransID, TransAmount, MSISDN, FirstName, AccountReference, BillRefNumber } = body;
  const account = (AccountReference || BillRefNumber || "").trim();
  const member  = MEMBERS[account];

  console.log(`MODE=${TransID ? "CONFIRM" : "VALIDATE"} account=${account} TransID=${TransID} amount=${TransAmount} from=${FirstName} MSISDN=${MSISDN}`);

  if (!member) {
    console.log("REJECTED: unknown account:", account);
    return Response.json({ ResultCode: "C2B00012", ResultDesc: "Invalid Account" });
  }

  // VALIDATION
  if (!TransID) {
    console.log("VALIDATED:", account, "→", member.name);
    return Response.json({ ResultCode: "0", ResultDesc: "Accepted" });
  }

  // CONFIRMATION
  try {
    const msg = `Dear ${member.name}, ${FirstName || "Someone"} has sent KES ${TransAmount} into your account ${account}. Mpee mali yake. Trans ID: ${TransID}`;
    console.log("SMS_MESSAGE:", msg);
    await sendSMS(member.phone, msg);
  } catch (err) {
    console.error("SMS_EXCEPTION:", err.message);
  }

  return Response.json({ ResultCode: "0", ResultDesc: "Success" });
}
