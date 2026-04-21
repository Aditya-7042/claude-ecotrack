import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-analytics.js";
import { getDatabase, ref, set, push } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-database.js";

// ============================================================
//  MASTER TOGGLE
//  false → Real mode  (Vercel deployed)
//  true  → Simulation (local dev / demo)
// ============================================================
const isSimulation = true;


// ── Firebase ──────────────────────────────────────────────────
const firebaseConfig = {
    apiKey: "AIzaSyCjJr9RfRARGbEOucL5-8EU6b-o-dtZxyg",
    authDomain: "ecotrack-a8cc2.firebaseapp.com",
    projectId: "ecotrack-a8cc2",
    storageBucket: "ecotrack-a8cc2.firebasestorage.app",
    messagingSenderId: "972183035152",
    appId: "1:972183035152:web:f41f1e1c7d673176f51995",
    measurementId: "G-W282276SN8"
};
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getDatabase(app);
const sessionId = "session_" + Date.now();
document.getElementById('session-label').textContent = sessionId.slice(-8);
const API_BASE_URL = resolveApiBaseUrl();
const apiAvailability = {
    audit: API_BASE_URL !== null,
    ai: API_BASE_URL !== null
};

// ── State ─────────────────────────────────────────────────────
let totalBytes   = 0;
let intervalId   = null;
let auditDone    = false;
let lastCarbonMg = 0;
let lastMb       = 0;
const chatHistory = [];

// ── Chart.js setup ────────────────────────────────────────────
const chartLabels = [];
const chartData   = [];
const carbonChart = new Chart(
    document.getElementById('carbonChart').getContext('2d'),
    {
        type: 'line',
        data: {
            labels: chartLabels,
            datasets: [{
                label: 'Carbon (mg CO₂)',
                data: chartData,
                borderColor: '#00ff88',
                backgroundColor: 'rgba(0,255,136,0.08)',
                pointBackgroundColor: '#00ff88',
                pointRadius: 4,
                pointHoverRadius: 6,
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 500 },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#090d15',
                    borderColor: '#1c3050',
                    borderWidth: 1,
                    titleColor: '#00ff88',
                    bodyColor: '#c0d4e8',
                    titleFont: { family: 'Space Mono', size: 11 },
                    bodyFont:  { family: 'Space Mono', size: 11 },
                    callbacks: {
                        label: ctx => ` ${ctx.parsed.y.toFixed(2)} mg CO₂`
                    }
                }
            },
            scales: {
                x: {
                    ticks: { color: '#304558', font: { family: 'Space Mono', size: 9 }, maxTicksLimit: 8 },
                    grid:  { color: 'rgba(19,30,46,0.8)' }
                },
                y: {
                    beginAtZero: true,
                    ticks: { color: '#304558', font: { family: 'Space Mono', size: 9 },
                             callback: v => v.toFixed(1) + 'mg' },
                    grid:  { color: 'rgba(19,30,46,0.8)' }
                }
            }
        }
    }
);

// ── Helpers ───────────────────────────────────────────────────
function getGreenRating(mg) {
    if (mg < 10)  return { grade: 'A+', label: 'Excellent', cls: 'grade-ap' };
    if (mg < 50)  return { grade: 'A',  label: 'Great',     cls: 'grade-a'  };
    if (mg < 100) return { grade: 'B',  label: 'Good',      cls: 'grade-b'  };
    if (mg < 200) return { grade: 'C',  label: 'Average',   cls: 'grade-c'  };
    if (mg < 300) return { grade: 'D',  label: 'Poor',      cls: 'grade-d'  };
    return               { grade: 'F',  label: 'Critical',  cls: 'grade-f'  };
}

function getEquivalent(mg) {
    if (mg < 1)   return `${(mg * 1000).toFixed(1)} μg CO₂`;
    if (mg < 100) return `≈ LED bulb on for ${(mg / 0.5).toFixed(0)}s`;
    if (mg < 500) return `≈ ${(mg / 140).toFixed(2)}m phone charge`;
    return               `≈ ${(mg / 140000).toFixed(5)}km car drive`;
}

function fmtMg(mg) {
    return mg >= 1000 ? (mg / 1000).toFixed(3) + ' g' : mg.toFixed(2) + ' mg';
}

function calculateAuditLocally(bytes) {
    const inputBytes = Number(bytes);
    const safeBytes = Number.isFinite(inputBytes) && inputBytes >= 0 ? inputBytes : 0;
    const KWH_PER_GB = 0.06;
    const CARBON_INTENSITY = 475;
    const gb = safeBytes / (1024 ** 3);
    const energyKwh = gb * KWH_PER_GB;
    const carbonG = energyKwh * CARBON_INTENSITY;
    const carbonMg = carbonG * 1000;

    return {
        success: true,
        carbonMg: Number(carbonMg.toFixed(2)),
        carbonG: Number(carbonG.toFixed(6)),
        energyKwh: Number(energyKwh.toFixed(8)),
        dataGb: Number(gb.toFixed(8)),
        source: 'client-fallback'
    };
}

function resolveApiBaseUrl() {
    const configured = window.ECOTRACK_API_BASE?.trim?.();
    if (configured) return configured.replace(/\/$/, '');

    const { origin, hostname, port, protocol } = window.location;
    const isLocalPreview = ['127.0.0.1', 'localhost'].includes(hostname)
        && ['5500', '5501'].includes(port);

    if (protocol === 'file:' || isLocalPreview) return null;
    return origin.replace(/\/$/, '');
}

function buildApiUrl(path) {
    if (!API_BASE_URL) return null;
    return `${API_BASE_URL}${path}`;
}

function isLocalDevServer() {
    return API_BASE_URL === null;
}

async function getAuditResult(bytes) {
    const auditUrl = buildApiUrl('/api/audit');
    if (!auditUrl || !apiAvailability.audit) {
        return calculateAuditLocally(bytes);
    }

    try {
        const response = await fetch(auditUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bytes })
        });

        const contentType = response.headers.get('content-type') || '';
        if (!response.ok || !contentType.includes('application/json')) {
            throw new Error(`Audit API unavailable (${response.status})`);
        }

        const result = await response.json();
        if (!Number.isFinite(Number(result?.carbonMg))) {
            throw new Error('Audit API returned invalid carbon data');
        }

        return result;
    } catch (err) {
        apiAvailability.audit = false;
        console.warn('Falling back to local audit calculation:', err);
        return calculateAuditLocally(bytes);
    }
}

// ── Core update ───────────────────────────────────────────────
async function updateUI(bytes) {
    try {
        const result = await getAuditResult(bytes);
        const carbonMg = parseFloat(result.carbonMg);
        const mb = bytes / (1024 * 1024);

        lastCarbonMg = carbonMg;
        lastMb = mb;

        // ── Main cards ──
        document.getElementById('data-val').innerText = mb.toFixed(2) + ' MB';
        document.getElementById('data-sub').innerText = 'Page resources measured';
        document.getElementById('carbon-val').innerText = fmtMg(carbonMg);
        document.getElementById('carbon-sub').innerText = `Updated ${new Date().toLocaleTimeString()}`;

        // ── Rating ──
        const r = getGreenRating(carbonMg);
        const rv = document.getElementById('rating-val');
        rv.innerText = `${r.grade} — ${r.label}`;
        rv.className = 'card-value ' + r.cls;
        document.getElementById('rating-sub').innerText = 'Efficiency grade';

        // ── Equivalent ──
        document.getElementById('equiv-val').innerText = getEquivalent(carbonMg);

        // ── 1K visits ──
        document.getElementById('visits-val').innerText = fmtMg(carbonMg * 1000);
        document.getElementById('visits-sub').innerText = `= ${(carbonMg / 1000).toFixed(5)}g per visit`;

        // ── Status badge ──
        const badge = document.getElementById('status-badge');
        const isCritical = carbonMg > 250;
        if (isCritical) {
            badge.innerText = '● CRITICAL';
            badge.className = 'critical';
            document.getElementById('card-carbon').className = 'card critical-card';
        } else {
            badge.innerText = isSimulation ? '● SIMULATING' : '● LIVE';
            badge.className = '';
            document.getElementById('card-carbon').className = 'card accent';
        }

        // ── CPU (sim mode only) ──
        if (isSimulation) {
            const cpuEl = document.getElementById('cpu-val');
            cpuEl.innerText = isCritical
                ? (Math.floor(Math.random() * 15) + 85) + '%'
                : (Math.floor(Math.random() * 13) + 12) + '%';
            cpuEl.style.color = isCritical ? 'var(--red)' : 'var(--text)';
        }

        // ── Chart ──
        const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        chartLabels.push(t);
        chartData.push(carbonMg);
        if (chartLabels.length > 30) { chartLabels.shift(); chartData.shift(); }
        carbonChart.update();
        document.getElementById('chart-meta').innerText =
            `${chartData.length} data point${chartData.length !== 1 ? 's' : ''} · last ${t}`;

        // ── Firebase sync ──
        push(ref(db, 'history/' + sessionId), {
            mb: mb.toFixed(3), carbon_mg: carbonMg,
            rating: r.grade, timestamp: Date.now()
        });
        set(ref(db, 'live_audit/' + sessionId), {
            mb_transferred: mb.toFixed(2), carbon_mg: carbonMg,
            rating: r.grade, status: isCritical ? 'CRITICAL' : 'NOMINAL',
            timestamp: Date.now()
        });

        // ── AI Advisor (auto, once per audit) ──
        runAIAdvisorSafe(mb, carbonMg, r.grade);

    } catch (err) {
        console.error('updateUI error:', err);
    }
}

// ── AI Advisor ────────────────────────────────────────────────
let advisorRan = false;

function buildLocalAdvisorReply(mb, carbonMg, rating) {
    const transferTip = mb > 2
        ? 'Your transfer size is heavy, so the biggest win is reducing downloaded assets.'
        : 'Your transfer size is fairly light, so keeping third-party scripts and images lean will help most.';
    const sourceTip = carbonMg > 100
        ? 'The most likely contributors are large images, external libraries, and repeated network requests.'
        : 'The likely contributors are JavaScript bundles, fonts, and third-party requests.';

    return `**Audit summary:** This page transferred **${mb.toFixed(2)} MB** and produced about **${carbonMg.toFixed(2)} mg CO2**, which maps to a **${rating}** rating. ${transferTip}

**Likely sources:** ${sourceTip} On this page, Firebase, Chart.js, fonts, and any uncached media are the first things to inspect.

**Top fixes:** compress and lazy-load images, self-host or trim third-party libraries, and defer scripts that are not needed for first paint.`;
}

function buildLocalChatReply(userMsg) {
    const msg = userMsg.toLowerCase();
    const rating = getGreenRating(lastCarbonMg).grade;

    if (msg.includes('compare') || msg.includes('average')) {
        return `Your audit is currently **${lastCarbonMg.toFixed(2)} mg CO2** for **${lastMb.toFixed(2)} MB** transferred, which maps to **${rating}**. As a rule of thumb, keeping transfer size low is the fastest way to beat the average page footprint.`;
    }

    if (msg.includes('cause') || msg.includes('emission') || msg.includes('source')) {
        return `The main sources are usually **images**, **JavaScript bundles**, **fonts**, and **third-party scripts**. For this page, Firebase, Chart.js, and any uncached media are the first things worth checking.`;
    }

    if (msg.includes('tip') || msg.includes('reduce') || msg.includes('optimi')) {
        return `Start with **image compression**, **lazy loading**, and **deferring non-critical JavaScript**. After that, trim third-party libraries and verify that every external request is necessary on first load.`;
    }

    return `The latest audit shows **${lastMb.toFixed(2)} MB** transferred and about **${lastCarbonMg.toFixed(2)} mg CO2**, rated **${rating}**. The biggest improvement usually comes from shipping fewer bytes and removing non-essential third-party code.`;
}
async function runAIAdvisor(mb, carbonMg, rating) {
    if (advisorRan && !isSimulation) return; // only once in real mode
    advisorRan = true;

    const box = document.getElementById('ai-advisor-box');
    box.innerHTML = `
        <div class="ai-loading">
            <div class="dots"><span>.</span><span>.</span><span>.</span></div>
            <span>AI is analysing your audit data...</span>
        </div>`;

    const prompt = `You are EcoTrack's AI Carbon Advisor. A webpage was audited:
- Data transferred: ${mb.toFixed(2)} MB
- Carbon impact: ${carbonMg.toFixed(2)} mg CO₂
- Green rating: ${rating}
- Stack: Firebase SDK, vanilla JS, CSS (typical EcoTrack page)

Write a concise analysis in exactly 3 short paragraphs:
1. What these numbers mean in plain English
2. The most likely sources of emissions for this page type
3. Top 3 specific, actionable optimisation tips

Format: Use **bold** for key terms. Max 160 words. Be direct and technical.`;

    const aiUrl = buildApiUrl('/api/ai');
    if (!aiUrl || !apiAvailability.ai) {
        const html = buildLocalAdvisorReply(mb, carbonMg, rating)
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .split('\n').filter(l => l.trim())
            .map(l => `<p>${l}</p>`).join('');

        box.innerHTML = `
            <div class="ai-result">
                <div class="ai-result-header">Local analysis · ${new Date().toLocaleTimeString()}</div>
                ${html}
            </div>`;
        return;
    }

    try {
        const res = await fetch(aiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 
            },
            body: JSON.stringify({
    message: prompt
})
        });
        const contentType = res.headers.get('content-type') || '';
        if (!res.ok || !contentType.includes('application/json')) {
            throw new Error(`AI API unavailable (${res.status})`);
        }
        const data = await res.json();
        const text = data.reply || 'No response.';

        const html = text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .split('\n').filter(l => l.trim())
            .map(l => `<p>${l}</p>`).join('');

        box.innerHTML = `
            <div class="ai-result">
                <div class="ai-result-header">⬡ Analysis · ${new Date().toLocaleTimeString()}</div>
                ${html}
            </div>`;
    } catch (e) {
        console.error('AI Advisor error:', e);
        box.innerHTML = `<div class="ai-idle"><div class="idle-dot"></div><span>AI unavailable — check API connection.</span></div>`;
    }
}

// ── AI Chat ───────────────────────────────────────────────────
const chatLog = document.getElementById('chat-messages');

function appendMsg(text, role) {
    const d = document.createElement('div');
    d.className = 'msg ' + role;
    if (role === 'ai') {
        d.innerHTML = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
    } else {
        d.textContent = text;
    }
    chatLog.appendChild(d);
    chatLog.scrollTop = chatLog.scrollHeight;
    return d;
}

async function sendMessage(userMsg) {
    if (!userMsg.trim()) return;
    appendMsg(userMsg, 'user');
    const thinkEl = appendMsg('⬡ AI thinking...', 'thinking');

    const systemPrompt = `You are EcoTrack's AI assistant specialising in web carbon emissions and sustainable web development.
Current audit data:
- Data transferred: ${lastMb.toFixed(2)} MB
- Carbon impact: ${lastCarbonMg.toFixed(2)} mg CO₂
- Green rating: ${getGreenRating(lastCarbonMg).grade}

Answer in 2-4 sentences. Use **bold** for key terms. Be specific and practical.`;

    chatHistory.push({ role: 'user', content: userMsg });

    const aiUrl = buildApiUrl('/api/ai');
    if (!aiUrl || !apiAvailability.ai) {
        chatLog.removeChild(thinkEl);
        const reply = buildLocalChatReply(userMsg);
        chatHistory.push({ role: 'assistant', content: reply });
        appendMsg(reply, 'ai');
        return;
    }

    try {
        const res = await fetch(aiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 
                 },
            body: JSON.stringify({
                message: `${systemPrompt}\n\nUser question: ${userMsg}`
            })
        });
        const contentType = res.headers.get('content-type') || '';
        if (!res.ok || !contentType.includes('application/json')) {
            throw new Error(`AI API unavailable (${res.status})`);
        }
        const data = await res.json();
        const reply = data.reply || 'Sorry, no response.';
        chatHistory.push({ role: 'assistant', content: reply });

        chatLog.removeChild(thinkEl);
        appendMsg(reply, 'ai');
    } catch (e) {
        chatLog.removeChild(thinkEl);
        appendMsg('AI unavailable — check your connection.', 'ai');
        console.error('Chat error:', e);
    }
}

async function runAIAdvisorSafe(mb, carbonMg, rating) {
    if (advisorRan && !isSimulation) return;
    advisorRan = true;

    const box = document.getElementById('ai-advisor-box');
    box.innerHTML = `
        <div class="ai-loading">
            <div class="dots"><span>.</span><span>.</span><span>.</span></div>
            <span>AI is analysing your audit data...</span>
        </div>`;

    const aiUrl = buildApiUrl('/api/ai');
    if (!aiUrl || !apiAvailability.ai) {
        const html = buildLocalAdvisorReply(mb, carbonMg, rating)
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .split('\n').filter(l => l.trim())
            .map(l => `<p>${l}</p>`).join('');

        box.innerHTML = `
            <div class="ai-result">
                <div class="ai-result-header">Local analysis · ${new Date().toLocaleTimeString()}</div>
                ${html}
            </div>`;
        return;
    }

    const prompt = `You are EcoTrack's AI Carbon Advisor. A webpage was audited:
- Data transferred: ${mb.toFixed(2)} MB
- Carbon impact: ${carbonMg.toFixed(2)} mg CO2
- Green rating: ${rating}
- Stack: Firebase SDK, vanilla JS, CSS (typical EcoTrack page)

Write a concise analysis in exactly 3 short paragraphs:
1. What these numbers mean in plain English
2. The most likely sources of emissions for this page type
3. Top 3 specific, actionable optimisation tips

Format: Use **bold** for key terms. Max 160 words. Be direct and technical.`;

    try {
        const res = await fetch(aiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: prompt })
        });
        const contentType = res.headers.get('content-type') || '';
        if (!res.ok || !contentType.includes('application/json')) {
            throw new Error(`AI API unavailable (${res.status})`);
        }

        const data = await res.json();
        const text = data.reply || 'No response.';
        const html = text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .split('\n').filter(l => l.trim())
            .map(l => `<p>${l}</p>`).join('');

        box.innerHTML = `
            <div class="ai-result">
                <div class="ai-result-header">Analysis · ${new Date().toLocaleTimeString()}</div>
                ${html}
            </div>`;
    } catch (error) {
        apiAvailability.ai = false;
        const html = buildLocalAdvisorReply(mb, carbonMg, rating)
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .split('\n').filter(l => l.trim())
            .map(l => `<p>${l}</p>`).join('');

        box.innerHTML = `
            <div class="ai-result">
                <div class="ai-result-header">Local analysis · ${new Date().toLocaleTimeString()}</div>
                ${html}
            </div>`;
        console.error('AI Advisor error:', error);
    }
}

async function sendMessageSafe(userMsg) {
    if (!userMsg.trim()) return;

    const aiUrl = buildApiUrl('/api/ai');
    if (!aiUrl || !apiAvailability.ai) {
        appendMsg(userMsg, 'user');
        const reply = buildLocalChatReply(userMsg);
        chatHistory.push({ role: 'user', content: userMsg });
        chatHistory.push({ role: 'assistant', content: reply });
        appendMsg(reply, 'ai');
        return;
    }

    appendMsg(userMsg, 'user');
    const thinkEl = appendMsg('AI thinking...', 'thinking');
    chatHistory.push({ role: 'user', content: userMsg });

    const systemPrompt = `You are EcoTrack's AI assistant specialising in web carbon emissions and sustainable web development.
Current audit data:
- Data transferred: ${lastMb.toFixed(2)} MB
- Carbon impact: ${lastCarbonMg.toFixed(2)} mg CO2
- Green rating: ${getGreenRating(lastCarbonMg).grade}

Answer in 2-4 sentences. Use **bold** for key terms. Be specific and practical.`;

    try {
        const res = await fetch(aiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: `${systemPrompt}\n\nUser question: ${userMsg}`
            })
        });
        const contentType = res.headers.get('content-type') || '';
        if (!res.ok || !contentType.includes('application/json')) {
            throw new Error(`AI API unavailable (${res.status})`);
        }

        const data = await res.json();
        const reply = data.reply || 'Sorry, no response.';
        chatHistory.push({ role: 'assistant', content: reply });
        chatLog.removeChild(thinkEl);
        appendMsg(reply, 'ai');
    } catch (error) {
        apiAvailability.ai = false;
        chatLog.removeChild(thinkEl);
        const reply = buildLocalChatReply(userMsg);
        chatHistory.push({ role: 'assistant', content: reply });
        appendMsg(reply, 'ai');
        console.error('Chat error:', error);
    }
}

sendMessage = sendMessageSafe;

document.getElementById('send-btn').addEventListener('click', () => {
    const input = document.getElementById('chat-input');
    sendMessageSafe(input.value);
    input.value = '';
});
document.getElementById('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
        const input = document.getElementById('chat-input');
        sendMessageSafe(input.value);
        input.value = '';
    }
});

// Quick suggestion chips
window.quickAsk = function(msg) { sendMessageSafe(msg); };

// ── Real mode ─────────────────────────────────────────────────
if (!isSimulation) {
    document.getElementById('sim-controls').style.display = 'none';

    // CPU Pressure
    if ('PressureObserver' in window) {
        try {
            new PressureObserver(records => {
                const state = records[0].state.toUpperCase();
                const el = document.getElementById('cpu-val');
                el.innerText = state;
                el.style.color = (state === 'CRITICAL' || state === 'SERIOUS')
                    ? 'var(--red)' : 'var(--text)';
            }).observe('cpu');
        } catch (e) {
            document.getElementById('cpu-val').innerText = 'Unavailable';
        }
    } else {
        document.getElementById('cpu-val').innerText = 'Not supported';
    }

    // One-time audit on load
    window.addEventListener('load', () => {
        setTimeout(() => {
            if (auditDone) return;
            auditDone = true;

            performance.getEntriesByType('resource').forEach(e => {
                if (e.name.includes('/api/audit')) return;
                const size = e.transferSize > 0 ? e.transferSize : e.decodedBodySize;
                if (size > 0) totalBytes += size;
            });

            const nav = performance.getEntriesByType('navigation')[0];
            if (nav) {
                const s = nav.transferSize > 0 ? nav.transferSize : nav.decodedBodySize;
                if (s > 0) totalBytes += s;
            }

            updateUI(totalBytes);
        }, 1500);
    });
}

// ── Simulation mode ───────────────────────────────────────────
function startSimulation() {
    if (!isSimulation || intervalId) return;
    document.getElementById('status-badge').innerText = '● SIMULATING';
    intervalId = setInterval(() => {
        const img = new Image();
        img.src = `https://picsum.photos/200/200?random=${Math.floor(Math.random()*10000)}&t=${Date.now()}`;
        img.onload = () => { totalBytes += 150 * 1024; updateUI(totalBytes); };
    }, 2000);
}
function stopSimulation() {
    if (!isSimulation || !intervalId) return;
    clearInterval(intervalId); intervalId = null;
    document.getElementById('status-badge').innerText = '● STANDBY';
    document.getElementById('status-badge').className = '';
}

document.getElementById('start-btn').addEventListener('click', startSimulation);
document.getElementById('stop-btn').addEventListener('click', stopSimulation);
