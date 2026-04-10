import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-analytics.js";
import { getDatabase, ref, set, push } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-database.js";

// ============================================================
//  MASTER TOGGLE
//  false → Real mode  (Vercel deployed)
//  true  → Simulation (local dev / demo)
// ============================================================
const isSimulation = false;


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

// ── Core update ───────────────────────────────────────────────
async function updateUI(bytes) {
    try {
        const response = await fetch('/api/audit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bytes })
        });
        const result = await response.json();
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
        runAIAdvisor(mb, carbonMg, r.grade);

    } catch (err) {
        console.error('updateUI error:', err);
    }
}

// ── AI Advisor ────────────────────────────────────────────────
let advisorRan = false;
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

    try {
        const res = await fetch('/api/ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 
            },
            body: JSON.stringify({
            message: prompt + "\n\nBe precise and helpful."
})
        });
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

    try {
        const res = await fetch('/api/ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 
                 },
            body: JSON.stringify({
  message: systemPrompt + "\n\nUser: " + userMsg
})
        });
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

document.getElementById('send-btn').addEventListener('click', () => {
    const input = document.getElementById('chat-input');
    sendMessage(input.value);
    input.value = '';
});
document.getElementById('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
        const input = document.getElementById('chat-input');
        sendMessage(input.value);
        input.value = '';
    }
});

// Quick suggestion chips
window.quickAsk = function(msg) { sendMessage(msg); };

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
