import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  type CallToolRequest,
  type ListToolsRequest,
} from "@modelcontextprotocol/sdk/types.js";

// Real-time exchange rates cache
let exchangeRatesCache: any = null;
let lastFetchTime = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

// Transfer storage (in production, use a database)
const transfers = new Map<string, any>();
let transferCounter = 1000;

// Transfer limits
const transferLimits = {
  daily: 10000,
  perTransaction: 5000,
  monthlyLimit: 50000,
  fees: { standard: 0.015, minFee: 2.99, maxFee: 50 },
};

// MyBambu supported corridors - GLOBAL COVERAGE
const SUPPORTED_CORRIDORS = [
  // Latin America & Caribbean
  { country: "Mexico", currency: "MXN", deliveryTime: "35 minutes", region: "Latin America" },
  { country: "Guatemala", currency: "GTQ", deliveryTime: "1-2 hours", region: "Latin America" },
  { country: "Honduras", currency: "HNL", deliveryTime: "1-2 hours", region: "Latin America" },
  { country: "Dominican Republic", currency: "DOP", deliveryTime: "35 minutes", region: "Caribbean" },
  { country: "El Salvador", currency: "USD", deliveryTime: "35 minutes", region: "Latin America" },
  { country: "Colombia", currency: "COP", deliveryTime: "1-3 hours", region: "Latin America" },
  { country: "Peru", currency: "PEN", deliveryTime: "1-3 hours", region: "Latin America" },
  { country: "Ecuador", currency: "USD", deliveryTime: "1-3 hours", region: "Latin America" },
  { country: "Nicaragua", currency: "NIO", deliveryTime: "2-4 hours", region: "Latin America" },
  { country: "Costa Rica", currency: "CRC", deliveryTime: "1-2 hours", region: "Latin America" },
  { country: "Brazil", currency: "BRL", deliveryTime: "1-3 hours", region: "Latin America" },
  { country: "Argentina", currency: "ARS", deliveryTime: "2-4 hours", region: "Latin America" },
  { country: "Chile", currency: "CLP", deliveryTime: "1-3 hours", region: "Latin America" },
  { country: "Panama", currency: "PAB", deliveryTime: "1-2 hours", region: "Latin America" },
  { country: "Bolivia", currency: "BOB", deliveryTime: "2-4 hours", region: "Latin America" },
  { country: "Paraguay", currency: "PYG", deliveryTime: "2-4 hours", region: "Latin America" },
  { country: "Uruguay", currency: "UYU", deliveryTime: "2-4 hours", region: "Latin America" },
  { country: "Venezuela", currency: "VES", deliveryTime: "2-4 hours", region: "Latin America" },
  { country: "Jamaica", currency: "JMD", deliveryTime: "1-3 hours", region: "Caribbean" },
  { country: "Trinidad and Tobago", currency: "TTD", deliveryTime: "2-4 hours", region: "Caribbean" },
  { country: "Haiti", currency: "HTG", deliveryTime: "2-4 hours", region: "Caribbean" },
  { country: "Cuba", currency: "CUP", deliveryTime: "4-6 hours", region: "Caribbean" },

  // Asia
  { country: "Philippines", currency: "PHP", deliveryTime: "1-3 hours", region: "Asia" },
  { country: "India", currency: "INR", deliveryTime: "2-4 hours", region: "Asia" },
  { country: "Vietnam", currency: "VND", deliveryTime: "2-4 hours", region: "Asia" },
  { country: "Thailand", currency: "THB", deliveryTime: "1-3 hours", region: "Asia" },
  { country: "Indonesia", currency: "IDR", deliveryTime: "2-4 hours", region: "Asia" },
  { country: "China", currency: "CNY", deliveryTime: "2-4 hours", region: "Asia" },
  { country: "Japan", currency: "JPY", deliveryTime: "1-3 hours", region: "Asia" },
  { country: "South Korea", currency: "KRW", deliveryTime: "1-3 hours", region: "Asia" },
  { country: "Pakistan", currency: "PKR", deliveryTime: "2-4 hours", region: "Asia" },
  { country: "Bangladesh", currency: "BDT", deliveryTime: "2-4 hours", region: "Asia" },
  { country: "Malaysia", currency: "MYR", deliveryTime: "1-3 hours", region: "Asia" },
  { country: "Singapore", currency: "SGD", deliveryTime: "35 minutes", region: "Asia" },
  { country: "Nepal", currency: "NPR", deliveryTime: "2-4 hours", region: "Asia" },
  { country: "Sri Lanka", currency: "LKR", deliveryTime: "2-4 hours", region: "Asia" },
  { country: "Myanmar", currency: "MMK", deliveryTime: "4-6 hours", region: "Asia" },
  { country: "Cambodia", currency: "KHR", deliveryTime: "2-4 hours", region: "Asia" },
  { country: "Taiwan", currency: "TWD", deliveryTime: "1-3 hours", region: "Asia" },
  { country: "Hong Kong", currency: "HKD", deliveryTime: "35 minutes", region: "Asia" },

  // Africa
  { country: "Nigeria", currency: "NGN", deliveryTime: "2-4 hours", region: "Africa" },
  { country: "Kenya", currency: "KES", deliveryTime: "1-3 hours", region: "Africa" },
  { country: "Ghana", currency: "GHS", deliveryTime: "2-4 hours", region: "Africa" },
  { country: "South Africa", currency: "ZAR", deliveryTime: "1-3 hours", region: "Africa" },
  { country: "Egypt", currency: "EGP", deliveryTime: "2-4 hours", region: "Africa" },
  { country: "Morocco", currency: "MAD", deliveryTime: "2-4 hours", region: "Africa" },
  { country: "Ethiopia", currency: "ETB", deliveryTime: "4-6 hours", region: "Africa" },
  { country: "Uganda", currency: "UGX", deliveryTime: "2-4 hours", region: "Africa" },
  { country: "Tanzania", currency: "TZS", deliveryTime: "2-4 hours", region: "Africa" },
  { country: "Senegal", currency: "XOF", deliveryTime: "2-4 hours", region: "Africa" },
  { country: "Ivory Coast", currency: "XOF", deliveryTime: "2-4 hours", region: "Africa" },
  { country: "Cameroon", currency: "XAF", deliveryTime: "2-4 hours", region: "Africa" },
  { country: "Zimbabwe", currency: "ZWL", deliveryTime: "4-6 hours", region: "Africa" },
  { country: "Rwanda", currency: "RWF", deliveryTime: "2-4 hours", region: "Africa" },

  // Europe
  { country: "United Kingdom", currency: "GBP", deliveryTime: "35 minutes", region: "Europe" },
  { country: "France", currency: "EUR", deliveryTime: "35 minutes", region: "Europe" },
  { country: "Germany", currency: "EUR", deliveryTime: "35 minutes", region: "Europe" },
  { country: "Spain", currency: "EUR", deliveryTime: "35 minutes", region: "Europe" },
  { country: "Italy", currency: "EUR", deliveryTime: "35 minutes", region: "Europe" },
  { country: "Netherlands", currency: "EUR", deliveryTime: "35 minutes", region: "Europe" },
  { country: "Poland", currency: "PLN", deliveryTime: "1-2 hours", region: "Europe" },
  { country: "Romania", currency: "RON", deliveryTime: "1-3 hours", region: "Europe" },
  { country: "Ukraine", currency: "UAH", deliveryTime: "2-4 hours", region: "Europe" },
  { country: "Russia", currency: "RUB", deliveryTime: "2-4 hours", region: "Europe" },
  { country: "Turkey", currency: "TRY", deliveryTime: "1-3 hours", region: "Europe" },
  { country: "Switzerland", currency: "CHF", deliveryTime: "35 minutes", region: "Europe" },
  { country: "Sweden", currency: "SEK", deliveryTime: "1-2 hours", region: "Europe" },
  { country: "Norway", currency: "NOK", deliveryTime: "1-2 hours", region: "Europe" },
  { country: "Denmark", currency: "DKK", deliveryTime: "1-2 hours", region: "Europe" },
  { country: "Portugal", currency: "EUR", deliveryTime: "35 minutes", region: "Europe" },
  { country: "Greece", currency: "EUR", deliveryTime: "1-2 hours", region: "Europe" },
  { country: "Czech Republic", currency: "CZK", deliveryTime: "1-2 hours", region: "Europe" },
  { country: "Hungary", currency: "HUF", deliveryTime: "1-3 hours", region: "Europe" },
  { country: "Austria", currency: "EUR", deliveryTime: "35 minutes", region: "Europe" },
  { country: "Belgium", currency: "EUR", deliveryTime: "35 minutes", region: "Europe" },
  { country: "Ireland", currency: "EUR", deliveryTime: "35 minutes", region: "Europe" },

  // Middle East
  { country: "United Arab Emirates", currency: "AED", deliveryTime: "1-2 hours", region: "Middle East" },
  { country: "Saudi Arabia", currency: "SAR", deliveryTime: "1-3 hours", region: "Middle East" },
  { country: "Jordan", currency: "JOD", deliveryTime: "2-4 hours", region: "Middle East" },
  { country: "Lebanon", currency: "LBP", deliveryTime: "2-4 hours", region: "Middle East" },
  { country: "Kuwait", currency: "KWD", deliveryTime: "1-3 hours", region: "Middle East" },
  { country: "Qatar", currency: "QAR", deliveryTime: "1-2 hours", region: "Middle East" },
  { country: "Bahrain", currency: "BHD", deliveryTime: "1-2 hours", region: "Middle East" },
  { country: "Oman", currency: "OMR", deliveryTime: "1-3 hours", region: "Middle East" },
  { country: "Israel", currency: "ILS", deliveryTime: "1-3 hours", region: "Middle East" },

  // Oceania
  { country: "Australia", currency: "AUD", deliveryTime: "1-3 hours", region: "Oceania" },
  { country: "New Zealand", currency: "NZD", deliveryTime: "1-3 hours", region: "Oceania" },
  { country: "Fiji", currency: "FJD", deliveryTime: "2-4 hours", region: "Oceania" },
  { country: "Papua New Guinea", currency: "PGK", deliveryTime: "4-6 hours", region: "Oceania" },

  // North America (non-Latin)
  { country: "Canada", currency: "CAD", deliveryTime: "35 minutes", region: "North America" },
  { country: "United States", currency: "USD", deliveryTime: "instant", region: "North America" },
];

// Fetch real-time exchange rates
async function fetchExchangeRates() {
  const now = Date.now();

  if (exchangeRatesCache && (now - lastFetchTime) < CACHE_DURATION) {
    return exchangeRatesCache;
  }

  try {
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    const data: any = await response.json();

    exchangeRatesCache = {
      base: 'USD',
      rates: data.rates,
      timestamp: new Date(data.date).toISOString(),
    };
    lastFetchTime = now;

    return exchangeRatesCache;
  } catch (error) {
    console.error('Failed to fetch exchange rates:', error);
    return exchangeRatesCache || {
      base: 'USD',
      rates: {
        MXN: 17.5, GTQ: 7.8, HNL: 24.5, DOP: 58.2,
        COP: 4100, PEN: 3.7, NIO: 36.5, CRC: 510
      },
      timestamp: new Date().toISOString(),
    };
  }
}

// Mock MyBambu API - simulate transfer processing
function simulateMyBambuTransfer(transferData: any) {
  // In production, this would call the real MyBambu API
  // For now, we'll simulate a successful transfer
  const statuses = ['pending', 'processing', 'completed'];
  const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];

  return {
    success: true,
    mybambuTransferId: `BAMBU-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    status: randomStatus,
    estimatedDelivery: new Date(Date.now() + 35 * 60 * 1000).toISOString(),
  };
}

// Component resources - these are the interactive widgets
function getTransferReceiptComponent(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      padding: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      color: #333;
    }
    .receipt {
      background: white;
      border-radius: 20px;
      padding: 28px;
      max-width: 500px;
      margin: 0 auto;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      animation: slideUp 0.4s ease-out;
    }
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .header {
      text-align: center;
      padding-bottom: 20px;
      border-bottom: 2px solid #f0f0f0;
    }
    .mybambu-logo {
      font-size: 24px;
      font-weight: 700;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 8px;
    }
    .status {
      display: inline-block;
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
      margin-top: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .status-pending { background: #fff3cd; color: #856404; }
    .status-processing { background: #cfe2ff; color: #084298; }
    .status-completed { background: #d1e7dd; color: #0f5132; }
    .amount-section {
      text-align: center;
      padding: 32px 0;
      background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
      border-radius: 16px;
      margin: 20px 0;
    }
    .amount {
      font-size: 52px;
      font-weight: 800;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      line-height: 1.2;
    }
    .currency { font-size: 24px; color: #666; font-weight: 600; margin-top: 4px; }
    .details {
      background: #f8f9fa;
      border-radius: 12px;
      padding: 20px;
      margin: 20px 0;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid #e0e0e0;
      align-items: center;
    }
    .detail-row:last-child { border-bottom: none; }
    .label { color: #666; font-size: 14px; }
    .value { font-weight: 600; color: #333; text-align: right; }
    .recipient {
      text-align: center;
      padding: 24px;
      font-size: 18px;
      color: #333;
      background: linear-gradient(135deg, rgba(102, 126, 234, 0.05) 0%, rgba(118, 75, 162, 0.05) 100%);
      border-radius: 12px;
      margin: 20px 0;
    }
    .recipient-name {
      font-size: 22px;
      font-weight: 700;
      margin: 8px 0;
      color: #667eea;
    }
    .transfer-id {
      text-align: center;
      color: #999;
      font-size: 11px;
      margin-top: 20px;
      font-family: 'Courier New', monospace;
      padding: 12px;
      background: #f8f9fa;
      border-radius: 8px;
    }
    .actions {
      margin-top: 24px;
      display: flex;
      gap: 12px;
    }
    button {
      flex: 1;
      padding: 14px 20px;
      border: none;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-primary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(102, 126, 234, 0.4);
    }
    .btn-secondary {
      background: #f8f9fa;
      color: #333;
      border: 2px solid #e0e0e0;
    }
    .btn-secondary:hover {
      background: #e9ecef;
    }
    @media (max-width: 480px) {
      body { padding: 12px; }
      .receipt { padding: 20px; }
      .amount { font-size: 42px; }
    }
  </style>
</head>
<body>
  <div class="receipt" id="receipt">
    <div class="header">
      <div class="mybambu-logo">MyBambu</div>
      <h2 style="color: #333; font-size: 20px;">💸 Transfer Receipt</h2>
      <div class="status" id="status">PENDING</div>
    </div>

    <div class="recipient">
      <div style="font-size: 14px; color: #666;">Sending to</div>
      <div class="recipient-name" id="recipientName">Loading...</div>
      <div style="font-size: 16px; color: #666; margin-top: 4px;" id="recipientCountry">Loading...</div>
    </div>

    <div class="amount-section">
      <div style="font-size: 14px; color: #666; margin-bottom: 8px;">They receive</div>
      <div class="amount" id="amount">0.00</div>
      <div class="currency" id="currency">USD</div>
    </div>

    <div class="details">
      <div class="detail-row">
        <span class="label">You sent</span>
        <span class="value" id="sentAmount">$0.00</span>
      </div>
      <div class="detail-row">
        <span class="label">Transfer fee</span>
        <span class="value" id="fee">$0.00</span>
      </div>
      <div class="detail-row">
        <span class="label">Exchange rate</span>
        <span class="value" id="rate">1 USD = 0.00</span>
      </div>
      <div class="detail-row">
        <span class="label">Delivery time</span>
        <span class="value" id="delivery">35 minutes</span>
      </div>
      <div class="detail-row">
        <span class="label">Estimated arrival</span>
        <span class="value" id="arrival">Calculating...</span>
      </div>
    </div>

    <div class="actions">
      <button class="btn-secondary" onclick="checkStatus()">Check Status</button>
      <button class="btn-primary" onclick="viewHistory()">View History</button>
    </div>

    <div class="transfer-id" id="transferId">ID: Loading...</div>
  </div>

  <script>
    // Access window.openai provided by ChatGPT Apps SDK
    function render() {
      if (!window.openai || !window.openai.toolOutput) {
        setTimeout(render, 100);
        return;
      }

      const data = window.openai.toolOutput;

      // Update all fields with transfer data
      document.getElementById('recipientName').textContent = data.recipient_name;
      document.getElementById('recipientCountry').textContent = data.recipient_country;
      document.getElementById('amount').textContent = data.recipient_amount.toFixed(2);
      document.getElementById('currency').textContent = data.to_currency;
      document.getElementById('sentAmount').textContent = \`$\${data.amount.toFixed(2)} \${data.from_currency}\`;
      document.getElementById('fee').textContent = \`$\${data.fee.toFixed(2)} \${data.from_currency}\`;
      document.getElementById('rate').textContent = \`1 \${data.from_currency} = \${data.exchange_rate.toFixed(4)} \${data.to_currency}\`;
      document.getElementById('delivery').textContent = data.delivery_time;
      document.getElementById('arrival').textContent = new Date(data.estimated_arrival).toLocaleString();
      document.getElementById('transferId').textContent = \`ID: \${data.id}\`;

      // Update status with proper styling
      const statusEl = document.getElementById('status');
      statusEl.textContent = data.status.toUpperCase();
      statusEl.className = 'status status-' + data.status;
    }

    // Interactive actions using window.openai.callTool
    async function checkStatus() {
      if (window.openai && window.openai.callTool) {
        const data = window.openai.toolOutput;
        await window.openai.callTool({
          name: 'check_transfer_status',
          input: { transfer_id: data.id }
        });
      }
    }

    async function viewHistory() {
      if (window.openai && window.openai.sendFollowUpMessage) {
        await window.openai.sendFollowUpMessage({
          role: 'user',
          content: 'Show me my transfer history'
        });
      }
    }

    // Initialize on load
    document.addEventListener('DOMContentLoaded', render);
    window.addEventListener('openai:set_globals', render);
  </script>
</body>
</html>`;
}

function getExchangeRateComponent(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 20px;
      background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
      min-height: 100vh;
    }
    .rate-card {
      background: white;
      border-radius: 20px;
      padding: 32px;
      max-width: 420px;
      margin: 0 auto;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      animation: fadeIn 0.4s ease-out;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: scale(0.95); }
      to { opacity: 1; transform: scale(1); }
    }
    .mybambu-logo {
      font-size: 18px;
      font-weight: 700;
      background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      text-align: center;
      margin-bottom: 8px;
    }
    .title {
      text-align: center;
      color: #333;
      margin-bottom: 28px;
      font-size: 18px;
      font-weight: 600;
    }
    .rate-display {
      text-align: center;
      padding: 36px 24px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 16px;
      color: white;
      position: relative;
      overflow: hidden;
    }
    .rate-display::before {
      content: '';
      position: absolute;
      top: -50%;
      right: -50%;
      width: 200%;
      height: 200%;
      background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%);
      animation: pulse 3s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 0.5; }
      50% { transform: scale(1.1); opacity: 0.8; }
    }
    .currencies {
      font-size: 22px;
      opacity: 0.95;
      font-weight: 600;
      position: relative;
      z-index: 1;
    }
    .rate-value {
      font-size: 64px;
      font-weight: 800;
      margin: 20px 0;
      position: relative;
      z-index: 1;
      text-shadow: 0 2px 10px rgba(0,0,0,0.2);
    }
    .arrow {
      font-size: 28px;
      margin: 12px 0;
      opacity: 0.9;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-top: 24px;
    }
    .info-box {
      background: #f8f9fa;
      padding: 16px;
      border-radius: 12px;
      text-align: center;
    }
    .info-label {
      font-size: 12px;
      color: #666;
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .info-value {
      font-size: 16px;
      font-weight: 700;
      color: #333;
    }
    .timestamp {
      text-align: center;
      color: #999;
      font-size: 12px;
      margin-top: 24px;
      padding-top: 20px;
      border-top: 1px solid #e0e0e0;
    }
    button {
      width: 100%;
      padding: 14px;
      margin-top: 20px;
      border: none;
      border-radius: 10px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(102, 126, 234, 0.4);
    }
  </style>
</head>
<body>
  <div class="rate-card">
    <div class="mybambu-logo">MyBambu</div>
    <h2 class="title">💱 Live Exchange Rate</h2>
    <div class="rate-display">
      <div class="currencies" id="fromCurrency">1 USD</div>
      <div class="arrow">↓</div>
      <div class="rate-value" id="rateValue">0.0000</div>
      <div class="currencies" id="toCurrency">MXN</div>
    </div>
    <div class="info-grid">
      <div class="info-box">
        <div class="info-label">Our Fee</div>
        <div class="info-value">$0.85+</div>
      </div>
      <div class="info-box">
        <div class="info-label">Delivery</div>
        <div class="info-value" id="deliveryTime">35 min</div>
      </div>
    </div>
    <button onclick="sendMoney()">Send Money Now</button>
    <div class="timestamp" id="timestamp">Updated: Loading...</div>
  </div>

  <script>
    function render() {
      if (!window.openai || !window.openai.toolOutput) {
        setTimeout(render, 100);
        return;
      }

      const data = window.openai.toolOutput;

      document.getElementById('fromCurrency').textContent = \`1 \${data.from_currency}\`;
      document.getElementById('rateValue').textContent = data.rate.toFixed(4);
      document.getElementById('toCurrency').textContent = data.to_currency;
      document.getElementById('timestamp').textContent = \`Updated: \${new Date(data.timestamp).toLocaleString()}\`;

      if (data.delivery_time) {
        document.getElementById('deliveryTime').textContent = data.delivery_time;
      }
    }

    async function sendMoney() {
      if (window.openai && window.openai.sendFollowUpMessage) {
        const data = window.openai.toolOutput;
        await window.openai.sendFollowUpMessage({
          role: 'user',
          content: \`Send money from \${data.from_currency} to \${data.to_currency}\`
        });
      }
    }

    document.addEventListener('DOMContentLoaded', render);
    window.addEventListener('openai:set_globals', render);
  </script>
</body>
</html>`;
}

function getTransferHistoryComponent(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
    }
    .container {
      background: white;
      border-radius: 20px;
      padding: 28px;
      max-width: 600px;
      margin: 0 auto;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .header {
      text-align: center;
      margin-bottom: 24px;
      padding-bottom: 20px;
      border-bottom: 2px solid #f0f0f0;
    }
    h1 {
      font-size: 24px;
      color: #333;
      margin-bottom: 4px;
    }
    .subtitle {
      font-size: 14px;
      color: #666;
    }
    .transfer-item {
      background: #f8f9fa;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 16px;
      cursor: pointer;
      transition: all 0.2s;
      border-left: 4px solid transparent;
    }
    .transfer-item:hover {
      transform: translateX(4px);
      border-left-color: #667eea;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }
    .transfer-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .transfer-amount {
      font-size: 24px;
      font-weight: 700;
      color: #667eea;
    }
    .transfer-status {
      padding: 6px 12px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .status-completed { background: #d1e7dd; color: #0f5132; }
    .status-pending { background: #fff3cd; color: #856404; }
    .status-processing { background: #cfe2ff; color: #084298; }
    .transfer-details {
      display: flex;
      justify-content: space-between;
      font-size: 14px;
      color: #666;
    }
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #999;
    }
    .empty-state-icon {
      font-size: 64px;
      margin-bottom: 16px;
      opacity: 0.5;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📋 Transfer History</h1>
      <p class="subtitle" id="subtitle">Loading your transfers...</p>
    </div>
    <div id="transferList"></div>
  </div>

  <script>
    function render() {
      if (!window.openai || !window.openai.toolOutput) {
        setTimeout(render, 100);
        return;
      }

      const data = window.openai.toolOutput;
      const transfers = data.transfers || [];

      document.getElementById('subtitle').textContent =
        transfers.length > 0
          ? \`\${transfers.length} transfer\${transfers.length !== 1 ? 's' : ''} found\`
          : 'No transfers yet';

      const listEl = document.getElementById('transferList');

      if (transfers.length === 0) {
        listEl.innerHTML = \`
          <div class="empty-state">
            <div class="empty-state-icon">📭</div>
            <p>No transfers yet</p>
            <p style="font-size: 12px; margin-top: 8px;">Start by sending money to your loved ones</p>
          </div>
        \`;
        return;
      }

      listEl.innerHTML = transfers.map(t => \`
        <div class="transfer-item" onclick="viewTransfer('\${t.id}')">
          <div class="transfer-header">
            <span class="transfer-amount">\${t.recipient_amount.toFixed(2)} \${t.to_currency}</span>
            <span class="transfer-status status-\${t.status}">\${t.status}</span>
          </div>
          <div class="transfer-details">
            <span>To: \${t.recipient_name}</span>
            <span>\${new Date(t.created_at).toLocaleDateString()}</span>
          </div>
        </div>
      \`).join('');
    }

    async function viewTransfer(id) {
      if (window.openai && window.openai.callTool) {
        await window.openai.callTool({
          name: 'check_transfer_status',
          input: { transfer_id: id }
        });
      }
    }

    document.addEventListener('DOMContentLoaded', render);
    window.addEventListener('openai:set_globals', render);
  </script>
</body>
</html>`;
}

// Create MCP server
function createTransfersServer(): Server {
  const server = new Server(
    {
      name: "mybambu-transfers",
      version: "1.0.0"
    },
    {
      capabilities: {
        tools: {},
        resources: {}
      }
    }
  );

  // Register component resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: "component://transfer-receipt",
        name: "Transfer Receipt Widget",
        mimeType: "text/html+skybridge",
        description: "Interactive transfer receipt with status tracking"
      },
      {
        uri: "component://exchange-rate",
        name: "Exchange Rate Widget",
        mimeType: "text/html+skybridge",
        description: "Live exchange rate display"
      },
      {
        uri: "component://transfer-history",
        name: "Transfer History Widget",
        mimeType: "text/html+skybridge",
        description: "Transfer history list"
      }
    ]
  }));

  // Serve component HTML
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;

    let html = '';
    if (uri === "component://transfer-receipt") {
      html = getTransferReceiptComponent();
    } else if (uri === "component://exchange-rate") {
      html = getExchangeRateComponent();
    } else if (uri === "component://transfer-history") {
      html = getTransferHistoryComponent();
    } else {
      throw new Error(`Unknown resource: ${uri}`);
    }

    return {
      contents: [{
        uri,
        mimeType: "text/html+skybridge",
        text: html
      }]
    };
  });

  // Register tools with proper metadata
  server.setRequestHandler(ListToolsRequestSchema, async (_request: ListToolsRequest) => ({
    tools: [
      {
        name: "send_money",
        description: "Use this when the user wants to send money internationally through MyBambu. Supports transfers to 90+ countries worldwide across Latin America, Asia, Africa, Europe, Middle East, Oceania, and North America. Low fees starting at $0.85 with delivery as fast as 35 minutes for select corridors.",
        inputSchema: {
          type: "object",
          properties: {
            amount: {
              type: "number",
              description: "Amount to send in USD (minimum $1, maximum $5000 per transaction)"
            },
            to_country: {
              type: "string",
              description: "Destination country - supports 90+ countries including Mexico, Philippines, India, Nigeria, UK, France, UAE, Australia, Canada, and many more"
            },
            recipient_name: {
              type: "string",
              description: "Full name of the recipient"
            },
          },
          required: ["amount", "to_country", "recipient_name"],
        },
        _meta: {
          "openai/outputTemplate": "component://transfer-receipt",
          "openai/toolInvocation": {
            invoking: "Processing your transfer with MyBambu...",
            invoked: "Transfer initiated successfully!"
          },
          readOnlyHint: false,
          destructiveHint: false
        }
      },
      {
        name: "get_exchange_rate",
        description: "Use this when the user wants to check the current exchange rate between USD and another currency. Provides live rates updated hourly with fee information and estimated delivery times.",
        inputSchema: {
          type: "object",
          properties: {
            to_currency: {
              type: "string",
              description: "Destination currency code (MXN, GTQ, HNL, DOP, COP, PEN, etc.)"
            },
            to_country: {
              type: "string",
              description: "Destination country name (optional, helps determine delivery time)"
            }
          },
          required: ["to_currency"],
        },
        _meta: {
          "openai/outputTemplate": "component://exchange-rate",
          "openai/toolInvocation": {
            invoking: "Fetching live exchange rates...",
            invoked: "Exchange rate retrieved"
          },
          readOnlyHint: true
        }
      },
      {
        name: "check_transfer_status",
        description: "Use this when the user wants to check the status of a specific transfer by transfer ID. Returns current status, delivery progress, and estimated arrival time.",
        inputSchema: {
          type: "object",
          properties: {
            transfer_id: {
              type: "string",
              description: "Transfer ID (format: TXN-XXXX)"
            },
          },
          required: ["transfer_id"],
        },
        _meta: {
          "openai/outputTemplate": "component://transfer-receipt",
          "openai/toolInvocation": {
            invoking: "Checking transfer status...",
            invoked: "Status updated"
          },
          readOnlyHint: true
        }
      },
      {
        name: "get_transfer_history",
        description: "Use this when the user wants to view their past transfers. Shows all transfers with their status, amounts, recipients, and dates.",
        inputSchema: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Maximum number of transfers to return (default: 10)"
            },
          },
        },
        _meta: {
          "openai/outputTemplate": "component://transfer-history",
          "openai/toolInvocation": {
            invoking: "Loading your transfer history...",
            invoked: "History loaded"
          },
          readOnlyHint: true
        }
      },
      {
        name: "get_supported_countries",
        description: "Use this when the user asks which countries MyBambu supports for money transfers. Returns a comprehensive list of 90+ supported countries across 6 continents with delivery times, currencies, and regional groupings.",
        inputSchema: {
          type: "object",
          properties: {
            region: {
              type: "string",
              description: "Optional: Filter by region (Latin America, Asia, Africa, Europe, Middle East, Oceania, North America, Caribbean)"
            }
          },
        },
        _meta: {
          "openai/toolInvocation": {
            invoking: "Fetching supported countries...",
            invoked: "Countries list retrieved"
          },
          readOnlyHint: true
        }
      }
    ],
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
    const toolName = request.params.name;
    const args = request.params.arguments ?? {};

    // TOOL: send_money
    if (toolName === "send_money") {
      const { amount, to_country, recipient_name } = args as any;

      // Validation
      if (amount <= 0) {
        return {
          content: [{
            type: "text",
            text: "❌ Amount must be greater than $0"
          }],
          isError: true
        };
      }

      if (amount > transferLimits.perTransaction) {
        return {
          content: [{
            type: "text",
            text: `❌ Amount exceeds per-transaction limit of $${transferLimits.perTransaction}. Please split into multiple transfers or contact support.`,
          }],
          isError: true
        };
      }

      // Find country info
      const corridor = SUPPORTED_CORRIDORS.find(c =>
        c.country.toLowerCase() === to_country.toLowerCase()
      );

      if (!corridor) {
        return {
          content: [{
            type: "text",
            text: `❌ Sorry, we don't support transfers to ${to_country} yet. Supported countries: ${SUPPORTED_CORRIDORS.map(c => c.country).join(', ')}`,
          }],
          isError: true
        };
      }

      // Get exchange rate
      const rateData = await fetchExchangeRates();
      const rate = rateData.rates[corridor.currency];

      if (!rate) {
        return {
          content: [{
            type: "text",
            text: `❌ Exchange rate not available for ${corridor.currency}`,
          }],
          isError: true
        };
      }

      // Calculate fees
      const feeAmount = Math.max(
        transferLimits.fees.minFee,
        Math.min(amount * transferLimits.fees.standard, transferLimits.fees.maxFee)
      );
      const netAmount = amount - feeAmount;
      const recipientAmount = netAmount * rate;
      const transferId = `TXN-${transferCounter++}`;

      // Simulate MyBambu API call
      const mybambuResponse = simulateMyBambuTransfer({
        amount,
        to_country,
        recipient_name,
        currency: corridor.currency
      });

      // Create transfer record
      const transfer = {
        id: transferId,
        mybambu_id: mybambuResponse.mybambuTransferId,
        from_currency: 'USD',
        to_currency: corridor.currency,
        amount,
        fee: feeAmount,
        net_amount: netAmount,
        exchange_rate: rate,
        recipient_amount: recipientAmount,
        recipient_name,
        recipient_country: corridor.country,
        delivery_time: corridor.deliveryTime,
        status: mybambuResponse.status,
        estimated_arrival: mybambuResponse.estimatedDelivery,
        created_at: new Date().toISOString(),
      };

      transfers.set(transferId, transfer);

      // Return structured response
      return {
        content: [{
          type: "text",
          text: `✅ Transfer initiated! ${recipient_name} in ${corridor.country} will receive ${recipientAmount.toFixed(2)} ${corridor.currency}. Estimated delivery: ${corridor.deliveryTime}. Transfer ID: ${transferId}`
        }],
        structuredContent: transfer,
        _meta: {
          mybambuResponse,
          feeBreakdown: {
            baseAmount: amount,
            feePercentage: transferLimits.fees.standard,
            feeAmount,
            netAmount,
            exchangeRate: rate,
            finalAmount: recipientAmount
          }
        }
      };
    }

    // TOOL: get_exchange_rate
    if (toolName === "get_exchange_rate") {
      const { to_currency, to_country } = args as any;

      const rateData = await fetchExchangeRates();
      const rate = rateData.rates[to_currency];

      if (!rate) {
        return {
          content: [{
            type: "text",
            text: `❌ Exchange rate not available for ${to_currency}`,
          }],
          isError: true
        };
      }

      // Find corridor for delivery time
      const corridor = SUPPORTED_CORRIDORS.find(c =>
        c.currency === to_currency ||
        (to_country && c.country.toLowerCase() === to_country.toLowerCase())
      );

      const responseData = {
        from_currency: 'USD',
        to_currency,
        rate,
        timestamp: rateData.timestamp,
        delivery_time: corridor?.deliveryTime || '1-3 hours'
      };

      return {
        content: [{
          type: "text",
          text: `💱 Current rate: 1 USD = ${rate.toFixed(4)} ${to_currency}\n\n📦 Delivery time: ${responseData.delivery_time}\n💰 Our fee: Starting at $0.85\n\nLast updated: ${new Date(rateData.timestamp).toLocaleString()}`
        }],
        structuredContent: responseData,
        _meta: {
          rawRateData: rateData,
          corridor
        }
      };
    }

    // TOOL: check_transfer_status
    if (toolName === "check_transfer_status") {
      const { transfer_id } = args as any;

      const transfer = transfers.get(transfer_id);

      if (!transfer) {
        return {
          content: [{
            type: "text",
            text: `❌ Transfer not found: ${transfer_id}. Please check the transfer ID and try again.`,
          }],
          isError: true
        };
      }

      // Simulate status progression
      const statuses = ['pending', 'processing', 'completed'];
      const currentIndex = statuses.indexOf(transfer.status);
      if (currentIndex < statuses.length - 1 && Math.random() > 0.5) {
        transfer.status = statuses[currentIndex + 1];
      }

      return {
        content: [{
          type: "text",
          text: `📊 Transfer Status: ${transfer.status.toUpperCase()}\n\n💸 ${transfer.recipient_amount.toFixed(2)} ${transfer.to_currency} to ${transfer.recipient_name}\n📅 Estimated arrival: ${new Date(transfer.estimated_arrival).toLocaleString()}\n🆔 ${transfer.id}`
        }],
        structuredContent: transfer,
        _meta: {
          statusHistory: [
            { status: 'pending', timestamp: transfer.created_at },
            { status: transfer.status, timestamp: new Date().toISOString() }
          ]
        }
      };
    }

    // TOOL: get_transfer_history
    if (toolName === "get_transfer_history") {
      const { limit = 10 } = args as any;

      const allTransfers = Array.from(transfers.values())
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, limit);

      return {
        content: [{
          type: "text",
          text: allTransfers.length > 0
            ? `📋 Found ${allTransfers.length} transfer${allTransfers.length !== 1 ? 's' : ''}:\n\n` +
              allTransfers.map(t =>
                `• ${t.recipient_amount.toFixed(2)} ${t.to_currency} to ${t.recipient_name} - ${t.status.toUpperCase()} (${t.id})`
              ).join('\n')
            : `📭 No transfers found. Start by saying "Send $100 to Mexico"`
        }],
        structuredContent: {
          transfers: allTransfers,
          total: allTransfers.length
        }
      };
    }

    // TOOL: get_supported_countries
    if (toolName === "get_supported_countries") {
      const { region } = args as any;

      let corridors = SUPPORTED_CORRIDORS;
      if (region) {
        corridors = SUPPORTED_CORRIDORS.filter(c =>
          c.region.toLowerCase() === region.toLowerCase()
        );
      }

      // Group by region for better display
      const byRegion = corridors.reduce((acc: any, c) => {
        if (!acc[c.region]) acc[c.region] = [];
        acc[c.region].push(c);
        return acc;
      }, {});

      const regionText = Object.entries(byRegion)
        .map(([reg, countries]: [string, any]) =>
          `\n**${reg}** (${countries.length} countries):\n` +
          countries.map((c: any) =>
            `  • ${c.country} (${c.currency}) - ${c.deliveryTime}`
          ).join('\n')
        ).join('\n');

      return {
        content: [{
          type: "text",
          text: `🌍 MyBambu supports transfers to ${corridors.length} countries${region ? ` in ${region}` : ' worldwide'}:\n` +
            regionText +
            `\n\n💰 Low fees starting at $0.85\n⚡ Fast delivery in as little as 35 minutes\n🌎 6 continents covered`
        }],
        structuredContent: {
          corridors,
          byRegion,
          total: corridors.length,
          regions: Object.keys(byRegion)
        }
      };
    }

    throw new Error(`Unknown tool: ${toolName}`);
  });

  return server;
}

// Session management
type SessionRecord = { server: Server; transport: SSEServerTransport };
const sessions = new Map<string, SessionRecord>();
const ssePath = "/mcp";
const postPath = "/mcp/messages";

async function handleSseRequest(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const server = createTransfersServer();
  const transport = new SSEServerTransport(postPath, res);
  const sessionId = transport.sessionId;

  sessions.set(sessionId, { server, transport });

  transport.onclose = async () => {
    sessions.delete(sessionId);
    await server.close();
  };

  transport.onerror = (error) => console.error("SSE transport error", error);

  try {
    await server.connect(transport);
  } catch (error) {
    sessions.delete(sessionId);
    console.error("Failed to start SSE session", error);
    if (!res.headersSent) {
      res.writeHead(500).end("Failed to establish SSE connection");
    }
  }
}

async function handlePostMessage(req: IncomingMessage, res: ServerResponse, url: URL) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  const sessionId = url.searchParams.get("sessionId");

  if (!sessionId) {
    res.writeHead(400).end("Missing sessionId query parameter");
    return;
  }

  const session = sessions.get(sessionId);
  if (!session) {
    res.writeHead(404).end("Unknown session");
    return;
  }

  try {
    await session.transport.handlePostMessage(req, res);
  } catch (error) {
    console.error("Failed to process message", error);
    if (!res.headersSent) {
      res.writeHead(500).end("Failed to process message");
    }
  }
}

// HTTP Server
const port = Number(process.env.PORT ?? 8000);

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (!req.url) {
    res.writeHead(400).end("Missing URL");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "OPTIONS" && (url.pathname === ssePath || url.pathname === postPath)) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === ssePath) {
    await handleSseRequest(res);
    return;
  }

  if (req.method === "POST" && url.pathname === postPath) {
    await handlePostMessage(req, res, url);
    return;
  }

  res.writeHead(404).end("Not Found");
});

httpServer.on("clientError", (err: Error, socket) => {
  console.error("HTTP client error", err);
  socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

httpServer.listen(port, () => {
  console.log(`\n🚀 MyBambu Transfers - MCP Server Ready!`);
  console.log(`   Version: 1.0.0`);
  console.log(`   Port: ${port}`);
  console.log(`   SSE Endpoint: http://localhost:${port}${ssePath}`);
  console.log(`   POST Endpoint: http://localhost:${port}${postPath}?sessionId=...`);
  console.log(`\n💡 Supported Features:`);
  console.log(`   • Send money to 90+ countries across 6 continents`);
  console.log(`   • Latin America, Asia, Africa, Europe, Middle East, Oceania`);
  console.log(`   • Live exchange rates (updated hourly)`);
  console.log(`   • Transfer status tracking`);
  console.log(`   • Transfer history`);
  console.log(`   • Interactive widgets with window.openai`);
  console.log(`\n🔗 To expose publicly: npx ngrok http ${port}`);
  console.log(`   or use: npx localtunnel --port ${port}\n`);
});
