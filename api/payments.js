export default async function handler(req, res) {
  console.log("🔔 Incoming request:", req.method, req.url);

  if (req.method !== "POST") {
    console.log("❌ Invalid method:", req.method);
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Log the raw body
  console.log("📦 Raw body:", req.body);

  const { transId, time, amount, name, phone, account } = req.body || {};
  console.log("✅ Parsed fields:", { transId, time, amount, name, phone, account });

  // Always respond quickly to Daraja
  res.json({ ResultCode: "0", ResultDesc: "Success" });

  // Forward to Google Apps Script endpoint
  try {
    const response = await fetch(process.env.SHEET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transId, time, amount, name, phone, account })
    });

    const text = await response.text();
    console.log("📤 Forwarded to sheet, response:", text);
  } catch (err) {
    console.error("❌ Sheet forwarding failed:", err);
  }
}
