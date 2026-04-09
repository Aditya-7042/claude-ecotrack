// ============================================================
//  EcoTrack API · api/audit.js
//  Vercel Serverless · Node.js 20.x
// ============================================================
export default function handler(req, res) {

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    // Info endpoint
    if (req.method === 'GET') {
        return res.status(200).json({
            name: 'EcoTrack Carbon Audit API',
            version: '2.0',
            endpoint: 'POST /api/audit',
            body: '{ bytes: number }',
            constants: { KWH_PER_GB: 0.06, CARBON_INTENSITY_G_PER_KWH: 475 }
        });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Only POST or GET allowed' });
    }

    // Validate
    const { bytes } = req.body;
    const inputBytes = parseFloat(bytes);
    if (isNaN(inputBytes) || inputBytes < 0 || !isFinite(inputBytes)) {
        return res.status(400).json({ success: false, message: 'Invalid bytes: must be a non-negative number' });
    }

    // ── Constants (Website Carbon Calculator methodology) ──
    const KWH_PER_GB       = 0.06;   // kWh per GB transferred
    const CARBON_INTENSITY = 475;    // gCO₂ per kWh (global average)

    // ── Calculation ──
    const gb       = inputBytes / (1024 ** 3);
    const energyKwh = gb * KWH_PER_GB;
    const carbonG  = energyKwh * CARBON_INTENSITY;
    const carbonMg = carbonG * 1000;

    // ── Green rating ──
    let rating = 'A+';
    if      (carbonMg > 300) rating = 'F';
    else if (carbonMg > 200) rating = 'D';
    else if (carbonMg > 100) rating = 'C';
    else if (carbonMg > 50)  rating = 'B';
    else if (carbonMg > 10)  rating = 'A';

    // ── Scale comparisons ──
    const per1kVisitsMg  = carbonMg * 1000;
    const per1kVisitsG   = per1kVisitsMg / 1000;
    const annualG        = per1kVisitsG * 365;  // 1k daily visitors, 1 year

    return res.status(200).json({
        success:    true,
        carbonMg:   Number(carbonMg.toFixed(2)),
        carbonG:    Number(carbonG.toFixed(6)),
        energyKwh:  Number(energyKwh.toFixed(8)),
        dataGb:     Number(gb.toFixed(8)),
        rating,
        comparisons: {
            per1kVisitsMg: Number(per1kVisitsMg.toFixed(2)),
            per1kVisitsG:  Number(per1kVisitsG.toFixed(4)),
            annualG:       Number(annualG.toFixed(4))
        },
        meta: {
            KWH_PER_GB,
            CARBON_INTENSITY,
            runtime: 'Vercel Node.js 20.x',
            timestamp: Date.now()
        }
    });
}
