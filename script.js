function selectToken(ca) {
    document.getElementById('tokenInput').value = ca;
}

async function analyzeToken() {
    const tokenCA = document.getElementById('tokenInput').value.trim();
    const errorMsg = document.getElementById('errorMsg');
    const successMsg = document.getElementById('successMsg');
    const errorText = document.getElementById('errorText');
    const successText = document.getElementById('successText');
    const results = document.getElementById('results');
    const analyzeBtn = document.getElementById('analyzeBtn');

    errorMsg.classList.add('hidden');
    successMsg.classList.add('hidden');
    results.classList.add('hidden');

    if (!tokenCA || tokenCA.length !== 42 || !tokenCA.toLowerCase().startsWith('0x')) {
        errorText.textContent = 'Invalid token address. Must be 42 characters starting with 0x';
        errorMsg.classList.remove('hidden');
        return;
    }

    analyzeBtn.innerHTML = '<div class="flex items-center justify-center gap-2"><svg class="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>Fetching live data...</div>';
    analyzeBtn.disabled = true;

    try {
        const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenCA.toLowerCase()}`);

        if (!response.ok) {
            throw new Error(`API error (${response.status}). The token might not exist or API is temporarily down.`);
        }

        const data = await response.json();
        const pairs = data.pairs || [];

        if (pairs.length === 0) {
            throw new Error('No trading pairs found. This token might not be listed on any DEX yet, or the contract address is incorrect.');
        }

        // Filter for PulseChain pairs only
        const pulsePairs = pairs.filter(p => p.chainId === 'pulsechain' || p.chainId === 'pulse');

        if (pulsePairs.length === 0) {
            throw new Error('Token found but not on PulseChain. This bot only analyzes PulseChain tokens.');
        }

        // Get highest liquidity pair
        const topPair = pulsePairs.reduce((max, pair) => {
            const liq = parseFloat(pair.liquidity?.usd || 0);
            const maxLiq = parseFloat(max.liquidity?.usd || 0);
            return liq > maxLiq ? pair : max;
        });

        successText.textContent = `✓ Live data fetched from ${topPair.dexId}`;
        successMsg.classList.remove('hidden');

        const tokenData = {
            pair: `${topPair.baseToken.symbol}/${topPair.quoteToken.symbol}`,
            baseSymbol: topPair.baseToken.symbol,
            dex: topPair.dexId,
            price: parseFloat(topPair.priceUsd),
            priceChange24h: parseFloat(topPair.priceChange?.h24 || 0),
            priceChange6h: parseFloat(topPair.priceChange?.h6 || 0),
            priceChange1h: parseFloat(topPair.priceChange?.h1 || 0),
            volume24h: parseFloat(topPair.volume?.h24 || 0),
            liquidity: parseFloat(topPair.liquidity?.usd || 0),
            txns24h: (topPair.txns?.h24?.buys || 0) + (topPair.txns?.h24?.sells || 0),
            buys: topPair.txns?.h24?.buys || 0,
            sells: topPair.txns?.h24?.sells || 0,
            marketCap: parseFloat(topPair.marketCap || 0),
            fdv: parseFloat(topPair.fdv || 0)
        };

        const signal = generateAISignal(tokenData);
        displayResults(signal);
    } catch (err) {
        console.error('Analysis error:', err);
        errorText.textContent = err.message || 'Failed to analyze token. Please verify the contract address and try again.';
        errorMsg.classList.remove('hidden');
    } finally {
        analyzeBtn.innerHTML = 'Generate AI Signal';
        analyzeBtn.disabled = false;
    }
}

function generateAISignal(data) {
    let score = 50;
    const reasons = [];
    const warnings = [];

    // Price momentum
    if (data.priceChange24h > 20) {
        score += 25;
        reasons.push(`Explosive 24h momentum (+${data.priceChange24h.toFixed(1)}%)`);
    } else if (data.priceChange24h > 10) {
        score += 15;
        reasons.push(`Strong 24h momentum (+${data.priceChange24h.toFixed(1)}%)`);
    } else if (data.priceChange24h > 3) {
        score += 8;
        reasons.push(`Positive 24h trend (+${data.priceChange24h.toFixed(1)}%)`);
    } else if (data.priceChange24h < -20) {
        score -= 25;
        warnings.push(`Severe 24h dump (${data.priceChange24h.toFixed(1)}%)`);
    } else if (data.priceChange24h < -10) {
        score -= 15;
        warnings.push(`Heavy 24h losses (${data.priceChange24h.toFixed(1)}%)`);
    } else if (data.priceChange24h < -3) {
        score -= 8;
        warnings.push(`Negative 24h trend (${data.priceChange24h.toFixed(1)}%)`);
    }

    // Short-term momentum
    if (data.priceChange6h > 10) {
        score += 15;
        reasons.push(`Accelerating momentum (+${data.priceChange6h.toFixed(1)}% in 6h)`);
    } else if (data.priceChange6h < -10) {
        score -= 15;
        warnings.push(`Sharp 6h decline (${data.priceChange6h.toFixed(1)}%)`);
    }

    if (data.priceChange1h > 5) {
        score += 12;
        reasons.push(`Breaking out now (+${data.priceChange1h.toFixed(1)}% in 1h)`);
    } else if (data.priceChange1h < -5) {
        score -= 12;
        warnings.push(`Recent selloff (${data.priceChange1h.toFixed(1)}% in 1h)`);
    }

    // Buy/Sell pressure
    const buyRatio = data.buys / (data.buys + data.sells || 1);
    if (buyRatio > 0.7) {
        score += 18;
        reasons.push(`Overwhelming buy pressure (${(buyRatio * 100).toFixed(0)}% buys)`);
    } else if (buyRatio > 0.6) {
        score += 12;
        reasons.push(`Strong buy pressure (${(buyRatio * 100).toFixed(0)}% buys)`);
    } else if (buyRatio < 0.3) {
        score -= 18;
        warnings.push(`Heavy sell pressure (${((1 - buyRatio) * 100).toFixed(0)}% sells)`);
    } else if (buyRatio < 0.4) {
        score -= 12;
        warnings.push(`Sellers dominating (${((1 - buyRatio) * 100).toFixed(0)}% sells)`);
    }

    // Liquidity risk
    if (data.liquidity < 5000) {
        score -= 30;
        warnings.push(`EXTREME RISK: Very low liquidity ($${(data.liquidity / 1000).toFixed(1)}K)`);
    } else if (data.liquidity < 20000) {
        score -= 20;
        warnings.push(`HIGH RISK: Low liquidity ($${(data.liquidity / 1000).toFixed(1)}K)`);
    } else if (data.liquidity < 100000) {
        score -= 8;
        warnings.push(`Medium liquidity risk ($${(data.liquidity / 1000).toFixed(1)}K)`);
    } else if (data.liquidity > 1000000) {
        score += 8;
        reasons.push(`Strong liquidity ($${(data.liquidity / 1000000).toFixed(2)}M)`);
    }

    // Volume analysis
    const volToLiqRatio = data.volume24h / data.liquidity;
    if (volToLiqRatio > 3) {
        score += 12;
        reasons.push(`Exceptional volume (${volToLiqRatio.toFixed(1)}x liquidity)`);
    } else if (volToLiqRatio > 1.5) {
        score += 8;
        reasons.push(`High trading volume (${volToLiqRatio.toFixed(1)}x liquidity)`);
    } else if (volToLiqRatio < 0.1) {
        score -= 10;
        warnings.push(`Very low volume (${volToLiqRatio.toFixed(2)}x liquidity)`);
    }

    // Transaction activity
    if (data.txns24h > 1000) {
        score += 8;
        reasons.push(`Very active trading (${data.txns24h} txns/24h)`);
    } else if (data.txns24h > 500) {
        score += 5;
        reasons.push(`Active trading (${data.txns24h} txns/24h)`);
    } else if (data.txns24h < 50) {
        score -= 12;
        warnings.push(`Low activity (${data.txns24h} txns/24h)`);
    }

    // Pattern detection
    if (data.priceChange24h > 50 && data.priceChange6h < -10) {
        score -= 20;
        warnings.push('PUMP ALERT: Major pump cooling off rapidly');
    } else if (data.priceChange24h > 30 && data.priceChange6h < 0) {
        score -= 12;
        warnings.push('Caution: Strong pump showing weakness');
    }

    // Reversal patterns
    if (data.priceChange24h < -20 && data.priceChange1h > 5) {
        score += 15;
        reasons.push('Potential reversal: Bouncing after heavy dip');
    }

    // Determine signal
    let signalType, signalColor, confidence, emoji;
    if (score >= 80) {
        signalType = 'STRONG BUY';
        signalColor = 'bg-green-600';
        confidence = 'Very High';
        emoji = '🚀';
    } else if (score >= 65) {
        signalType = 'BUY';
        signalColor = 'bg-green-500';
        confidence = 'High';
        emoji = '📈';
    } else if (score >= 50) {
        signalType = 'WEAK BUY';
        signalColor = 'bg-green-400';
        confidence = 'Medium';
        emoji = '👍';
    } else if (score >= 40) {
        signalType = 'HOLD';
        signalColor = 'bg-yellow-500';
        confidence = 'Low';
        emoji = '⏸️';
    } else if (score >= 25) {
        signalType = 'WEAK SELL';
        signalColor = 'bg-orange-500';
        confidence = 'Medium';
        emoji = '👎';
    } else if (score >= 15) {
        signalType = 'SELL';
        signalColor = 'bg-red-500';
        confidence = 'High';
        emoji = '📉';
    } else {
        signalType = 'STRONG SELL';
        signalColor = 'bg-red-600';
        confidence = 'Very High';
        emoji = '🚨';
    }

    // Trade levels
    const risk = data.price * 0.02;
    const entry = data.price * 0.999;
    const stopLoss = Math.max(entry - 2 * risk, 0);
    const tp1 = entry + 2 * risk;
    const tp2 = entry + 4 * risk;
    const tp3 = entry + 6 * risk;

    return {
        ...data,
        signalType,
        signalColor,
        score,
        confidence,
        emoji,
        reasons,
        warnings,
        entry,
        stopLoss,
        tp1,
        tp2,
        tp3
    };
}

function displayResults(signal) {
    const results = document.getElementById('results');

    let html = `
                <div class="bg-white/10 backdrop-blur-lg rounded-2xl shadow-xl p-6 flex justify-between items-center">
                    <div>
                        <h3 class="text-xl font-bold text-white">Share Analysis</h3>
                        <p class="text-purple-200 text-sm">Share a link to this signal with others.</p>
                    </div>
                    <button onclick="shareResults()" id="shareBtn" class="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg flex items-center gap-2 transition-colors">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12s-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z"></path></svg>
                        <span>Share</span>
                    </button>
                </div>

        <div class="${signal.signalColor} rounded-2xl shadow-2xl p-6">
            <div class="flex items-center justify-between">
                <div>
                    <div class="text-5xl mb-2">${signal.emoji}</div>
                    <h2 class="text-3xl font-bold text-white">${signal.signalType}</h2>
                    <p class="text-white/90 text-lg">Confidence: ${signal.confidence}</p>
                </div>
                <div class="text-right">
                    <div class="text-sm text-white/80">AI Score</div>
                    <div class="text-4xl font-bold text-white">${signal.score}</div>
                    <div class="text-sm text-white/80">/ 100</div>
                </div>
            </div>
        </div>

        <div class="bg-white/10 backdrop-blur-lg rounded-2xl shadow-xl p-6">
            <h3 class="text-xl font-bold text-white mb-4">📊 Live Market Data</h3>
            <div class="grid grid-cols-2 gap-4">
                <div class="bg-white/5 rounded-lg p-4">
                    <div class="text-purple-300 text-sm">Token</div>
                    <div class="text-white font-bold text-lg">${signal.baseSymbol}</div>
                </div>
                <div class="bg-white/5 rounded-lg p-4">
                    <div class="text-purple-300 text-sm">Pair</div>
                    <div class="text-white font-bold">${signal.pair}</div>
                </div>
                <div class="bg-white/5 rounded-lg p-4">
                    <div class="text-purple-300 text-sm">Price</div>
                    <div class="text-white font-bold">$${signal.price < 0.01 ? signal.price.toFixed(10) : signal.price.toFixed(6)}</div>
                </div>
                <div class="bg-white/5 rounded-lg p-4">
                    <div class="text-purple-300 text-sm">24h Change</div>
                    <div class="font-bold text-lg ${signal.priceChange24h >= 0 ? 'text-green-400' : 'text-red-400'}">
                        ${signal.priceChange24h >= 0 ? '+' : ''}${signal.priceChange24h.toFixed(2)}%
                    </div>
                </div>
                <div class="bg-white/5 rounded-lg p-4">
                    <div class="text-purple-300 text-sm">6h Change</div>
                    <div class="font-bold ${signal.priceChange6h >= 0 ? 'text-green-400' : 'text-red-400'}">
                        ${signal.priceChange6h >= 0 ? '+' : ''}${signal.priceChange6h.toFixed(2)}%
                    </div>
                </div>
                <div class="bg-white/5 rounded-lg p-4">
                    <div class="text-purple-300 text-sm">1h Change</div>
                    <div class="font-bold ${signal.priceChange1h >= 0 ? 'text-green-400' : 'text-red-400'}">
                        ${signal.priceChange1h >= 0 ? '+' : ''}${signal.priceChange1h.toFixed(2)}%
                    </div>
                </div>
                <div class="bg-white/5 rounded-lg p-4">
                    <div class="text-purple-300 text-sm">24h Volume</div>
                    <div class="text-white font-bold">$${signal.volume24h >= 1000000 ? (signal.volume24h / 1000000).toFixed(2) + 'M' : (signal.volume24h / 1000).toFixed(1) + 'K'}</div>
                </div>
                <div class="bg-white/5 rounded-lg p-4">
                    <div class="text-purple-300 text-sm">Liquidity</div>
                    <div class="text-white font-bold">$${signal.liquidity >= 1000000 ? (signal.liquidity / 1000000).toFixed(2) + 'M' : (signal.liquidity / 1000).toFixed(1) + 'K'}</div>
                </div>
                <div class="bg-white/5 rounded-lg p-4">
                    <div class="text-purple-300 text-sm">24h Transactions</div>
                    <div class="text-white font-bold">${signal.txns24h}</div>
                </div>
                <div class="bg-white/5 rounded-lg p-4">
                    <div class="text-purple-300 text-sm">DEX</div>
                    <div class="text-white font-bold capitalize">${signal.dex}</div>
                </div>
            </div>
        </div>
    `;

    if (signal.reasons.length > 0) {
        html += `
            <div class="bg-green-500/20 backdrop-blur-lg rounded-2xl shadow-xl p-6 border-2 border-green-500/30">
                <h3 class="text-xl font-bold text-white mb-4">✅ Bullish Signals Detected</h3>
                <ul class="space-y-2">
                    ${signal.reasons.map(r => `<li class="flex items-start gap-3 text-green-100"><span class="text-green-400 text-xl">✓</span><span>${r}</span></li>`).join('')}
                </ul>
            </div>
        `;
    }

    if (signal.warnings.length > 0) {
        html += `
            <div class="bg-red-500/20 backdrop-blur-lg rounded-2xl shadow-xl p-6 border-2 border-red-500/30">
                <h3 class="text-xl font-bold text-white mb-4">⚠️ Risk Factors Identified</h3>
                <ul class="space-y-2">
                    ${signal.warnings.map(w => `<li class="flex items-start gap-3 text-red-100"><span class="text-red-400 text-xl">⚠</span><span>${w}</span></li>`).join('')}
                </ul>
            </div>
        `;
    }

    if (signal.signalType.includes('BUY')) {
        html += `
            <div class="bg-white/10 backdrop-blur-lg rounded-2xl shadow-xl p-6">
                <h3 class="text-xl font-bold text-white mb-4">💰 Suggested Trade Setup</h3>
                <div class="space-y-3">
                    <div class="flex justify-between items-center p-4 bg-blue-500/20 rounded-lg border border-blue-500/30">
                        <span class="text-blue-200 font-medium">Recommended Entry</span>
                        <span class="text-white font-bold text-lg">$${signal.entry < 0.01 ? signal.entry.toFixed(10) : signal.entry.toFixed(6)}</span>
                    </div>
                    <div class="flex justify-between items-center p-4 bg-red-500/20 rounded-lg border border-red-500/30">
                        <span class="text-red-200 font-medium">Stop Loss</span>
                        <span class="text-red-300 font-bold text-lg">$${signal.stopLoss < 0.01 ? signal.stopLoss.toFixed(10) : signal.stopLoss.toFixed(6)}</span>
                    </div>
                    <div class="flex justify-between items-center p-4 bg-green-500/20 rounded-lg border border-green-500/30">
                        <span class="text-green-200 font-medium">Take Profit 1 (2:1 R/R)</span>
                        <span class="text-green-300 font-bold text-lg">$${signal.tp1 < 0.01 ? signal.tp1.toFixed(10) : signal.tp1.toFixed(6)}</span>
                    </div>
                    <div class="flex justify-between items-center p-4 bg-green-500/20 rounded-lg border border-green-500/30">
                        <span class="text-green-200 font-medium">Take Profit 2 (4:1 R/R)</span>
                        <span class="text-green-300 font-bold text-lg">$${signal.tp2 < 0.01 ? signal.tp2.toFixed(10) : signal.tp2.toFixed(6)}</span>
                    </div>
                    <div class="flex justify-between items-center p-4 bg-green-500/20 rounded-lg border border-green-500/30">
                        <span class="text-green-200 font-medium">Take Profit 3 (6:1 R/R)</span>
                        <span class="text-green-300 font-bold text-lg">$${signal.tp3 < 0.01 ? signal.tp3.toFixed(10) : signal.tp3.toFixed(6)}</span>
                    </div>
                </div>
                <div class="mt-4 p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                    <p class="text-blue-200 text-sm">💡 <strong>Tip:</strong> Consider scaling out at each TP level (e.g., sell 33% at TP1, 33% at TP2, 34% at TP3)</p>
                </div>
            </div>
        `;
    }

    html += `
        <div class="bg-yellow-500/20 backdrop-blur-lg rounded-lg p-4 border border-yellow-500/30">
            <p class="text-yellow-100 text-sm">
                ⚠️ <strong>Disclaimer:</strong> This is AI-generated analysis based on live market data patterns and technical indicators. NOT financial advice. Always do your own research (DYOR) and never invest more than you can afford to lose. Past performance does not guarantee future results.
            </p>
        </div>
    `;

    results.innerHTML = html;
    results.classList.remove('hidden');
    results.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

document.getElementById('tokenInput').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') analyzeToken();
});

function shareResults() {
    const tokenCA = document.getElementById('tokenInput').value.trim();
    const shareBtn = document.getElementById('shareBtn');
    if (!tokenCA || !shareBtn) return;

    const url = new URL(window.location.href);
    url.searchParams.set('token', tokenCA);

    navigator.clipboard.writeText(url.href).then(() => {
        shareBtn.innerHTML = `
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
            <span>Copied!</span>`;
        setTimeout(() => {
            shareBtn.innerHTML = `
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12s-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z"></path></svg>
                <span>Share</span>`;
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy: ', err);
        shareBtn.textContent = 'Error copying';
    });
}


function checkURLForToken() {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    if (token && token.length === 42 && token.toLowerCase().startsWith('0x')) {
        document.getElementById('tokenInput').value = token;
        analyzeToken();
    }
}

// Check for token in URL on page load
checkURLForToken();
