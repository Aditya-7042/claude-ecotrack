export default async function handler(req, res) {
  try {
    const { message } = req.body;

    console.log("Incoming message:", message);
    console.log("API KEY EXISTS:", !!process.env.GEMINI_API_KEY);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: message }]
            }
          ]
        })
      }
    );

    const data = await response.json();

    console.log("===== GEMINI RESPONSE =====");
    console.log(JSON.stringify(data, null, 2));

    // 🚨 SHOW REAL ERROR
    if (data.error) {
      return res.status(500).json({
        reply: "API ERROR: " + data.error.message
      });
    }

    let reply = "No response from AI.";

    if (data.candidates && data.candidates.length > 0) {
      const parts = data.candidates[0].content?.parts;
      if (parts && parts.length > 0) {
        reply = parts.map(p => p.text || "").join("");
      }
    }

    res.status(200).json({ reply });

  } catch (err) {
    console.error("AI ERROR:", err);
    res.status(500).json({ reply: "Server error" });
  }
}
