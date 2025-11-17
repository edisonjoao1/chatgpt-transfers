# MyBambu Production Integration Guide

## Making This Demo Real - Money Movement

This guide explains how to integrate real payment processing to turn the ChatGPT demo into a production money transfer system.

---

## Architecture Overview

### Demo (Current):
```
ChatGPT → MCP Server → In-memory fake data
```

### Production (Target):
```
ChatGPT → MCP Server → Payment APIs → Real Banks
                           ↓
            User USD Account → FX → Colombian COP Account
```

---

## Option 1: Use Wise API (Recommended - Fastest Path)

Wise (formerly TransferWise) provides end-to-end money transfer infrastructure.

### Setup

```bash
npm install @transferwise/api
```

### Implementation

```typescript
import { Wise } from '@transferwise/api';

// Initialize
const wise = new Wise({
  apiKey: process.env.WISE_API_KEY,
  environment: 'production'
});

// Real send_money implementation
async function sendMoneyProduction(params: {
  amount: number;
  recipientName: string;
  recipientCountry: string;
  recipientBankAccount: string;
  recipientBankCode: string;
}) {
  // 1. Create quote
  const quote = await wise.quotes.create({
    sourceCurrency: 'USD',
    targetCurrency: 'COP',
    sourceAmount: params.amount,
    paymentMethod: 'BANK_TRANSFER'
  });

  // 2. Create recipient
  const recipient = await wise.recipients.create({
    currency: 'COP',
    type: 'colombian',
    profile: profileId,
    accountHolderName: params.recipientName,
    details: {
      legalType: 'PRIVATE',
      accountNumber: params.recipientBankAccount,
      bankCode: params.recipientBankCode
    }
  });

  // 3. Create and fund transfer
  const transfer = await wise.transfers.create({
    targetAccount: recipient.id,
    quoteUuid: quote.id,
    customerTransactionId: generateUniqueId()
  });

  // 4. Fund from user's balance
  const funding = await wise.transfers.fund({
    transferId: transfer.id
  });

  return {
    transferId: transfer.id,
    status: transfer.status,
    estimatedDelivery: quote.estimatedDelivery,
    fee: quote.fee,
    rate: quote.rate
  };
}
```

### Wise API Capabilities
- ✅ Collect USD from US bank accounts
- ✅ Execute FX at mid-market rates
- ✅ Pay out to Colombian banks
- ✅ Support 50+ destination countries
- ✅ Compliance & licensing handled
- ✅ Webhooks for status updates

---

## Option 2: Build Custom Stack

If you need more control or better rates, build with specialized providers:

### Stack Components

| Function | Provider Options | Purpose |
|----------|-----------------|---------|
| USD Collection | Plaid, Stripe, Dwolla | Debit from US banks |
| FX Conversion | Currencycloud, OFX | Get exchange rates |
| COP Payout | dLocal, Rapyd | Send to Colombian banks |
| Compliance | Seon, Sardine | KYC/AML checks |

### Implementation Example

```typescript
// 1. Collect USD (Plaid)
import { PlaidApi } from 'plaid';

async function debitUserAccount(userId: string, amount: number) {
  const transfer = await plaid.transferCreate({
    access_token: userAccessToken,
    account_id: userAccountId,
    amount: amount.toString(),
    type: 'debit',
    network: 'ach',
    description: 'MyBambu transfer'
  });

  return transfer.transfer_id;
}

// 2. Get FX rate (Currencycloud)
import { Currencycloud } from '@currencycloud/client';

async function getExchangeRate(fromCurrency: string, toCurrency: string, amount: number) {
  const rate = await currencycloud.rates.find({
    buy_currency: toCurrency,
    sell_currency: fromCurrency,
    amount: amount
  });

  return rate;
}

// 3. Send to Colombia (dLocal)
import { DLocal } from 'dlocal-sdk';

async function payoutToColombia(params: {
  amount: number;
  recipientName: string;
  bankAccount: string;
  documentId: string;
}) {
  const payout = await dlocal.payouts.create({
    amount: params.amount.toString(),
    currency: 'COP',
    country: 'CO',
    payer: {
      name: 'MyBambu Inc',
      document: process.env.MYBAMBU_TAX_ID
    },
    beneficiary: {
      name: params.recipientName,
      bank_account: params.bankAccount,
      document_type: 'CC',
      document_id: params.documentId
    },
    notification_url: 'https://api.mybambu.com/webhooks/payout'
  });

  return payout;
}
```

---

## Required Compliance

### KYC (Know Your Customer)
```typescript
import { Persona } from 'persona';

async function verifyUser(user: {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  ssn: string;
  address: string;
}) {
  const inquiry = await persona.inquiries.create({
    inquiry_template_id: 'tmpl_xyz',
    reference_id: user.id,
    fields: {
      name_first: user.firstName,
      name_last: user.lastName,
      birthdate: user.dateOfBirth,
      identification_number: user.ssn
    }
  });

  return inquiry.status; // 'approved', 'declined', 'pending'
}
```

### AML (Anti-Money Laundering)
```typescript
import { Seon } from '@seon/node-sdk';

async function checkTransaction(transfer: {
  amount: number;
  userId: string;
  ipAddress: string;
}) {
  const fraudCheck = await seon.fraudApi.scoreTransaction({
    user_id: transfer.userId,
    amount: transfer.amount,
    ip: transfer.ipAddress,
    transaction_type: 'money_transfer'
  });

  if (fraudCheck.fraud_score > 0.8) {
    // Flag for manual review
    await flagTransaction(transfer.id);
    return { approved: false, reason: 'High fraud score' };
  }

  return { approved: true };
}
```

---

## Database Schema (Production)

Replace in-memory storage with real database:

```sql
-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  kyc_status VARCHAR(50), -- 'pending', 'approved', 'rejected'
  created_at TIMESTAMP DEFAULT NOW()
);

-- Transfers table
CREATE TABLE transfers (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  amount_usd DECIMAL(10,2),
  amount_cop DECIMAL(12,2),
  exchange_rate DECIMAL(10,4),
  fee DECIMAL(10,2),
  recipient_name VARCHAR(255),
  recipient_country VARCHAR(2),
  recipient_bank_account VARCHAR(100),
  status VARCHAR(50), -- 'pending', 'processing', 'completed', 'failed'
  provider_transfer_id VARCHAR(255), -- Wise/dLocal transfer ID
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- Recipients table
CREATE TABLE recipients (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  name VARCHAR(255),
  country VARCHAR(2),
  currency VARCHAR(3),
  bank_account VARCHAR(100),
  bank_code VARCHAR(50),
  document_type VARCHAR(10),
  document_id VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Scheduled transfers table
CREATE TABLE scheduled_transfers (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  recipient_id UUID REFERENCES recipients(id),
  amount_usd DECIMAL(10,2),
  frequency VARCHAR(20), -- 'weekly', 'monthly', etc.
  next_execution TIMESTAMP,
  status VARCHAR(20), -- 'active', 'paused', 'cancelled'
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## Environment Variables

```bash
# Wise API
WISE_API_KEY=your_wise_api_key
WISE_PROFILE_ID=your_profile_id

# Or if using custom stack:
PLAID_CLIENT_ID=your_plaid_client_id
PLAID_SECRET=your_plaid_secret
CURRENCYCLOUD_API_KEY=your_cc_api_key
DLOCAL_API_KEY=your_dlocal_key

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/mybambu

# Compliance
PERSONA_API_KEY=your_persona_key
SEON_API_KEY=your_seon_key

# Webhooks
WEBHOOK_SECRET=your_webhook_secret
```

---

## Integration Steps

### 1. Update MCP Server

In `src/server.ts`, replace simulated functions:

```typescript
// OLD (Demo)
const transfer = {
  id: `TXN-${transferCounter++}`,
  status: 'completed', // Fake instant completion
  // ...
};

// NEW (Production)
const transfer = await sendMoneyProduction({
  amount: params.amount,
  recipientName: params.recipientName,
  recipientCountry: params.recipientCountry,
  recipientBankAccount: params.recipientBankAccount,
  recipientBankCode: params.recipientBankCode
});

// Listen for webhooks to update status
```

### 2. Add Webhook Handler

```typescript
import express from 'express';

const app = express();

app.post('/webhooks/wise', async (req, res) => {
  const event = req.body;

  if (event.data.current_state === 'outgoing_payment_sent') {
    // Update transfer status in database
    await db.transfers.update({
      id: event.data.resource.id,
      status: 'completed',
      completed_at: new Date()
    });

    // Notify user via ChatGPT or push notification
    await notifyUser(event.data.resource.profile);
  }

  res.status(200).send('OK');
});
```

### 3. Add Real Database

```typescript
import { Pool } from 'pg';

const db = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Replace in-memory maps
// OLD: const transfers = new Map<string, any>();

// NEW:
async function getTransfers(userId: string) {
  const result = await db.query(
    'SELECT * FROM transfers WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return result.rows;
}

async function saveTransfer(transfer: Transfer) {
  await db.query(
    'INSERT INTO transfers (id, user_id, amount_usd, ...) VALUES ($1, $2, $3, ...)',
    [transfer.id, transfer.userId, transfer.amount, ...]
  );
}
```

---

## Testing Production

### Sandbox Testing
```typescript
// Use test credentials
const wise = new Wise({
  apiKey: process.env.WISE_TEST_API_KEY,
  environment: 'sandbox'
});

// Test transfer
const testTransfer = await sendMoneyProduction({
  amount: 1.00, // Minimum test amount
  recipientName: 'Test User',
  recipientCountry: 'Colombia',
  recipientBankAccount: 'TEST_ACCOUNT',
  recipientBankCode: 'COLBANK'
});
```

### Integration Tests
```typescript
describe('Production Money Transfer', () => {
  it('should complete USD → COP transfer', async () => {
    const transfer = await sendMoneyProduction({
      amount: 100,
      recipientName: 'Maria Garcia',
      recipientCountry: 'Colombia',
      recipientBankAccount: '1234567890',
      recipientBankCode: 'BANCOLOMBIA'
    });

    expect(transfer.status).toBe('processing');
    expect(transfer.fee).toBeLessThan(5);
    expect(transfer.rate).toBeGreaterThan(3500); // COP per USD
  });
});
```

---

## Security Checklist

- [ ] Store API keys in environment variables, never in code
- [ ] Use HTTPS for all API communication
- [ ] Implement rate limiting on endpoints
- [ ] Validate all user inputs
- [ ] Encrypt sensitive data at rest
- [ ] Use webhook signatures to verify authenticity
- [ ] Implement transaction monitoring for fraud
- [ ] Log all financial transactions immutably
- [ ] Set up automated reconciliation
- [ ] Use 2FA for admin operations

---

## Licensing Requirements (US)

If operating as a money transmitter in the US, you need:

1. **Federal**: FinCEN MSB Registration
2. **State**: Money Transmitter License in each operating state
3. **Alternative**: Partner with a licensed entity (Wise, Stripe, etc.)

**Note**: Using Wise API means they handle licensing for you!

---

## Costs to Consider

| Service | Cost Structure |
|---------|---------------|
| Wise API | ~1-2% per transfer + small fixed fee |
| Plaid | Free for small volume, $0.10-0.30 per connected account |
| dLocal | ~2-3% per payout |
| Currencycloud | 0.5-1.5% FX markup |
| Database | $50-200/month (AWS RDS, Supabase) |
| Compliance Tools | $500-2000/month (Persona, Seon) |

**Total per $100 transfer**: $2-5 in fees

---

## Next Steps

1. **Week 1**: Set up Wise Business API sandbox
2. **Week 2**: Integrate with MCP server, test end-to-end
3. **Week 3**: Add database, implement KYC
4. **Week 4**: Security audit, compliance review
5. **Week 5**: Launch beta with limited users

---

## Support & Resources

- Wise API Docs: https://api-docs.wise.com/
- dLocal Docs: https://docs.dlocal.com/
- Plaid Docs: https://plaid.com/docs/
- Stripe Treasury: https://stripe.com/treasury

---

**Ready to make it real?** Start with Wise sandbox → https://sandbox.transferwise.tech/
