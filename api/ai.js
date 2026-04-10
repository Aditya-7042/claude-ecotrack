export default async function handler(req, res) {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ reply: "No message provided" });
    }

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
              role: "user",
              parts: [{ text: message }]
            }
          ]
        })
      }
    );

    const data = await response.json();

    console.log("===== GEMINI RESPONSE =====");
    console.log(JSON.stringify(data, null, 2));

    // 🚨 Handle API error
    if (data.error) {
      return res.status(500).json({
        reply: "API ERROR: " + data.error.message
      });
    }

    let reply = "";

    // ✅ SAFER parsing
    if (data.candidates?.length > 0) {
      const candidate = data.candidates[0];

      // normal text response
      if (candidate.content?.parts) {
        reply = candidate.content.parts
          .map(p => p.text || "")
          .join("");
      }

      // blocked or no text
      if (!reply && candidate.finishReason) {
        reply = `AI blocked response (${candidate.finishReason})`;
      }
    }

    // 🚨 FINAL fallback
    if (!reply) {
      reply = "DEBUG: " + JSON.stringify(data);
    }

    return res.status(200).json({ reply });

  } catch (err) {
    console.error("AI ERROR:", err);
    return res.status(500).json({
      reply: "Server error: " + err.message
    });
  }
}
