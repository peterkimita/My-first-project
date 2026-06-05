// pages/api/payments.js (Vercel)
// Pure JS: Daraja → TalkSasa SMS, with logs

export const config = {
  api: { bodyParser: false },
};

const TALK_SASA_URL = "https://bulksms.talksasa.com/api/v3/sms/send";
const TALK_SASA_TOKEN = process.env.TALK_SASA_TOKEN;
const SENDER_ID = "PejaBeauty";

// Account directory
const members = {
  "001": { name: "Richard", phone: "254113794559" },
  "002": { name: "Chris", phone: "254118569233" },
  "003": { name: "Waigwa", phone: "254751633623" },
  "004": { name: "Bonk", phone: "254741325170" },
  "005": { name: "Peter", phone: "254714082191" },
};

async function sendSMS(to, message) {
  try {
    console.log(`📨 Sending SMS to ${to}: ${message}`);
    const res = await fetch(TALK_SASA_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TALK_SASA_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: SENDER_ID,
        recipients: [String(to)],
        message,
      }),
    });
    const data = await res.json();
    console.log("✅ SMS response:", data);
  } catch (err) {
    console.error("❌ SMS error:", err.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    console.log("❌ Invalid method:", req.method);
    return res.status(405).json({ error: "Method not allowed" });
  }

  let rawBody = "";
  for await (const chunk of req) {
    rawBody += chunk;
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    const params = new URLSearchParams(rawBody);
    body = Object.fromEntries(params);
  }

  console.log("🔥 Incoming Daraja Payload:", JSON.stringify(body, null, 2));

  const {
    TransID,
    TransAmount,
    TransTime,
    MSISDN,
    FirstName,
    AccountReference,
    BillRefNumber,
  } = body;

  const account = AccountReference || BillRefNumber || "";
  const VALID_ACCOUNTS = Object.keys(members);

  // === VALIDATION ===
  if (!TransID) {
    if (!VALID_ACCOUNTS.includes(account)) {
      console.log(`❌ Validation Failed - Invalid Account: ${account}`);
      return res.json({
        ResultCode: "C2B00012",
        ResultDesc: "Invalid Account Reference",
      });
    }
    console.log(`✅ Validation Passed for Account: ${account}`);
    return res.json({ ResultCode: "0", ResultDesc: "Accepted" });
  }

  // === CONFIRMATION ===
  if (!VALID_ACCOUNTS.includes(account)) {
    console.log(`❌ Invalid Account in Confirmation: ${account}`);
    return res.json({
      ResultCode: "C2B00012",
      ResultDesc: "Invalid Account",
    });
  }

  try {
    const member = members[account];
    const message = `Dear ${member.name}, ${FirstName || "Someone"} has sent ${TransAmount} into your account number ${account}, mpee mali yake Trans ID ${TransID}`;

    console.log(`📊 Parsed Transaction: ID=${TransID}, Amount=${TransAmount}, Account=${account}, Sender=${FirstName}, Phone=${member.phone}`);

    await sendSMS(member.phone, message);

    console.log(`✅ SMS sent successfully for TransID ${TransID}`);
    return res.json({ ResultCode: "0", ResultDesc: "Success" });
  } catch (err) {
    console.error("❌ Error handling transaction:", err.message);
    return res.json({ ResultCode: "1", ResultDesc: "Internal Error" });
  }
}
