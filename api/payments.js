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

  console.log("🔥 Daraja Payload:", JSON.stringify(body, null, 2));

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

  const VALID_ACCOUNTS = ["001", "002", "003", "004", "005","006","007","008","009","010","011","012","013","014","015","016","017","018","019","020","021","022"];

  // VALIDATION REQUEST (Daraja calls this BEFORE accepting payment)
  if (!TransID) {
    if (!VALID_ACCOUNTS.includes(account)) {
      console.log(`❌ Validation Failed - Invalid Account: ${account}`);
      return res.json({ 
        ResultCode: "C2B00012", 
        ResultDesc: "Invalid Account Reference" 
      });
    }
    console.log(`✅ Validation Passed for Account: ${account}`);
    return res.json({ 
      ResultCode: "0", 
      ResultDesc: "Accepted" 
    });
  }

  // CONFIRMATION REQUEST (After successful payment)
  if (!VALID_ACCOUNTS.includes(account)) {
    console.log(`❌ Invalid Account in Confirmation: ${account}`);
    return res.json({ ResultCode: "C2B00012", ResultDesc: "Invalid Account" });
  }

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

    console.log(`✅ Transaction Saved: ${TransID} | Amount: ${TransAmount}`);
    return res.json({ ResultCode: "0", ResultDesc: "Success" });

  } catch (err) {
    console.error("Sheet Error:", err.message);
    return res.json({ ResultCode: "1", ResultDesc: "Internal Error" });
  }
}
