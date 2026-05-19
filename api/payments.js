import { IncomingForm } from "formidable";

export const config = {
  api: {
    bodyParser: false, // disable Next.js default JSON parser
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body = {};

  try {
    // Try parsing as JSON first
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks).toString();

    try {
      body = JSON.parse(rawBody);
    } catch (jsonErr) {
      // If not JSON, parse as form data
      const form = new IncomingForm();
      body = await new Promise((resolve, reject) => {
        form.parse(req, (err, fields) => {
          if (err) reject(err);
          else resolve(fields);
        });
      });
    }
  } catch (err) {
    console.error("Error parsing body:", err);
    return res.status(400).json({ error: "Invalid body format" });
  }

  console.log("Incoming Daraja payload:", body);

  // Map Daraja fields
  const {
    TransID,
    TransAmount,
    TransTime,
    MSISDN,
    FirstName,
    AccountReference,
  } = body;

  const transId = TransID;
  const amount = TransAmount;
  const time = TransTime;
  const phone = MSISDN;
  const name = FirstName;
  const account = AccountReference;

  const VALID_ACCOUNTS = ["001", "002", "003", "004", "005"];

  if (!VALID_ACCOUNTS.includes(account)) {
    return res.json({ ResultCode: "C2B00012", ResultDesc: "Invalid Account" });
  }

  try {
    await fetch(process.env.SHEET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transId, time, amount, name, phone, account }),
    });

    return res.json({ ResultCode: "0", ResultDesc: "Success" });
  } catch (err) {
    console.error("Error posting to Sheet:", err);
    return res.json({ ResultCode: "1", ResultDesc: "Sheet Error" });
  }
}
