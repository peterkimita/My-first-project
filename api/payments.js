export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
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

  console.log("Daraja Payload:", JSON.stringify(body, null, 2));

  const { 
    TransID, 
    TransAmount, 
    TransTime, 
    MSISDN, 
    FirstName, 
    AccountReference,
    BillRefNumber 
  } = body;

  const account = AccountReference || BillRefNumber || "";

  const VALID_ACCOUNTS = ["001", "002", "003", "004", "005"];

  // === VALIDATION LOGIC ===
  if (!VALID_ACCOUNTS.includes(account)) {
    console.log(`❌ Invalid Account: ${account}`);
    return res.json({ 
      ResultCode: "C2B00012", 
      ResultDesc: "Invalid Account Reference" 
    });
  }

  // If this is Validation request (usually no TransID yet)
  if (!TransID) {
    console.log("✅ Validation request accepted");
    return res.json({ 
      ResultCode: "0", 
      ResultDesc: "Accepted" 
    });
  }

  // === CONFIRMATION LOGIC (after payment) ===
  try {
    await fetch(process.env.SHEET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transId: TransID,
        time: TransTime,
        amount: TransAmount,
        name: FirstName || "Unknown",
        phone: MSISDN,
        account: account,
      }),
    });

    console.log(`✅ Transaction ${TransID} saved to sheet`);
    return res.json({ ResultCode: "0", ResultDesc: "Success" });

  } catch (err) {
    console.error("Sheet Error:", err.message);
    return res.json({ ResultCode: "1", ResultDesc: "Internal Error" });
  }
}
