'use strict';

const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());
app.use(cors());

// ─── Config ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 10000;
const SPREAD_BPS = parseInt(process.env.SPREAD_BPS || '300', 10); // 3%
const MONROE_TREASURY = process.env.MONROE_TREASURY || '0x15184bf50b3d3f52b60434f8942b7d52f2eb436e';
const HIVETRUST_URL = process.env.HIVETRUST_URL || 'https://hivetrust.onrender.com';
const SERVICE_NAME = 'hive-mdk-provider';
const BASE_URL = process.env.BASE_URL || 'https://hive-mdk-provider.onrender.com';

// ─── Rails ─────────────────────────────────────────────────────────────────────
const RAILS = [
  {
    chain: 'base',
    asset: 'USDC',
    network: 'base',
    chain_id: 8453,
    active: true,
    decimals: 6,
    contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    recipient: MONROE_TREASURY,
    scheme: 'exact',
    native: true,
    description: 'Base USDC via EIP-3009 transferWithAuthorization'
  },
  {
    chain: 'base',
    asset: 'USDT',
    network: 'base',
    chain_id: 8453,
    active: true,
    decimals: 6,
    contract: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
    recipient: MONROE_TREASURY,
    scheme: 'exact',
    native: true,
    description: 'Base USDT via EIP-3009 transferWithAuthorization'
  },
  {
    chain: 'solana',
    asset: 'USDC',
    network: 'solana',
    active: true,
    decimals: 6,
    contract: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    recipient: 'B1N61cuL35fhskWz5dw8XqDyP6LWi3ZWmq8CNA9L3FVn',
    scheme: 'exact',
    native: true,
    description: 'Solana USDC-SPL'
  },
  {
    chain: 'ethereum',
    asset: 'USDT',
    network: 'ethereum',
    chain_id: 1,
    active: true,
    decimals: 6,
    contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    recipient: MONROE_TREASURY,
    scheme: 'exact',
    native: false,
    description: 'Ethereum USDT (ERC-20)'
  }
];

// ─── In-memory state ────────────────────────────────────────────────────────────
const pendingReceipts = new Map(); // id → work-receipt + x402 challenge
const settledReceipts = new Map(); // id → settlement record
const stats = {
  work_receipts_processed: 0,
  work_receipts_settled: 0,
  total_settled_atomic_usdc: BigInt(0),
  total_spread_atomic_usdc: BigInt(0),
  unique_mining_dids: new Set()
};

// ─── Helpers ────────────────────────────────────────────────────────────────────
function spreadCalc(amountUsd) {
  const spread = (amountUsd * SPREAD_BPS) / 10000;
  const minerPayout = amountUsd - spread;
  return { spread_usd: +spread.toFixed(6), miner_payout_usd: +minerPayout.toFixed(6) };
}

function usdToAtomic(amountUsd, decimals = 6) {
  return Math.round(amountUsd * Math.pow(10, decimals));
}

function x402Challenge(receiptId, amountUsd) {
  const atomic = usdToAtomic(amountUsd);
  const expiresAt = Math.floor(Date.now() / 1000) + 300; // 5 min
  return {
    x402_version: '0.1',
    receipt_id: receiptId,
    resource: `/v1/mdk/work-receipt/settle/${receiptId}`,
    amount_usd: amountUsd,
    spread_bps: SPREAD_BPS,
    payment_endpoint: `/v1/mdk/work-receipt/settle/${receiptId}`,
    expires_at: expiresAt,
    accepts: [
      {
        chain: 'base',
        asset: 'USDC',
        scheme: 'eip3009',
        recipient_address: MONROE_TREASURY,
        asset_contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        decimals: 6,
        amount_usd: amountUsd,
        amount_atomic: String(atomic),
        amount_min_usd: +(amountUsd * 0.65).toFixed(6),
        amount_min_atomic: String(Math.round(atomic * 0.65))
      },
      {
        chain: 'base',
        asset: 'USDT',
        scheme: 'eip3009',
        recipient_address: MONROE_TREASURY,
        asset_contract: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
        decimals: 6,
        amount_usd: amountUsd,
        amount_atomic: String(atomic),
        amount_min_usd: +(amountUsd * 0.65).toFixed(6),
        amount_min_atomic: String(Math.round(atomic * 0.65))
      },
      {
        chain: 'solana',
        asset: 'USDC',
        scheme: 'spl',
        recipient_address: 'B1N61cuL35fhskWz5dw8XqDyP6LWi3ZWmq8CNA9L3FVn',
        asset_contract: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        decimals: 6,
        amount_usd: amountUsd,
        amount_atomic: String(atomic),
        amount_min_usd: +(amountUsd * 0.65).toFixed(6),
        amount_min_atomic: String(Math.round(atomic * 0.65))
      }
    ]
  };
}

// ─── Routes ─────────────────────────────────────────────────────────────────────

// GET /healthz
app.get('/healthz', (req, res) => {
  res.json({
    status: 'ok',
    service: SERVICE_NAME,
    version: '1.0.0',
    spread_bps: SPREAD_BPS,
    treasury: MONROE_TREASURY,
    uptime_seconds: Math.floor(process.uptime())
  });
});

// GET /.well-known/agent.json
app.get('/.well-known/agent.json', (req, res) => {
  res.json({
    schema_version: '1.0',
    name: SERVICE_NAME,
    did: 'did:web:hive-mdk-provider.onrender.com',
    description:
      'Non-Tether MDK settlement provider. Mining-side agent workloads settle through Hive at 3% spread. x402 on Base USDC + Solana USDC + Ethereum USDT.',
    endpoints: {
      base: BASE_URL,
      rails: '/v1/mdk/rails',
      submit: 'POST /v1/mdk/work-receipt/submit',
      settle: 'POST /v1/mdk/work-receipt/settle/:id',
      stats: '/v1/mdk/stats',
      leaderboard: '/v1/mdk/leaderboard'
    },
    payment: {
      x402: true,
      spread_bps: SPREAD_BPS,
      treasury: {
        evm: MONROE_TREASURY,
        evm_chains: [8453, 1],
        solana: 'B1N61cuL35fhskWz5dw8XqDyP6LWi3ZWmq8CNA9L3FVn',
        currencies: ['USDC', 'USDT']
      }
    },
    loyalty: { bogo: true, cross_surface: true },
    trust: {
      upstream_did: 'did:web:hivetrust.onrender.com',
      did_attested: true,
      hivetrust_url: HIVETRUST_URL
    },
    registry: 'https://hive-discovery.onrender.com',
    patent_pending:
      'Non-Tether MDK provider with multi-rail mining-receipt settlement and cross-surface loyalty'
  });
});

// GET /v1/mdk/rails
app.get('/v1/mdk/rails', (req, res) => {
  res.json({
    rails: RAILS,
    spread_bps: SPREAD_BPS,
    treasury: {
      evm: MONROE_TREASURY,
      solana: 'B1N61cuL35fhskWz5dw8XqDyP6LWi3ZWmq8CNA9L3FVn'
    },
    note: 'Mining-side settlement rails. Submit a signed work-receipt to POST /v1/mdk/work-receipt/submit to receive an x402 payment challenge.'
  });
});

// POST /v1/mdk/work-receipt/submit
// Accepts a signed proof-of-work attestation, returns x402 challenge for settlement.
// Without X-PAYMENT header, returns 402.
app.post('/v1/mdk/work-receipt/submit', (req, res) => {
  const xPayment = req.headers['x-payment'];

  // If no payment proof header, issue 402 challenge
  if (!xPayment) {
    const receiptId = uuidv4();
    const body = req.body || {};
    const amountUsd = parseFloat(body.amount_usd) || 1.00;
    const minerDid = body.miner_did || body.did || 'unknown';
    const workHash = body.work_hash || body.proof_hash || uuidv4();

    const challenge = x402Challenge(receiptId, amountUsd);
    pendingReceipts.set(receiptId, {
      receiptId,
      minerDid,
      workHash,
      amountUsd,
      challenge,
      submittedAt: new Date().toISOString(),
      status: 'pending_payment'
    });
    stats.work_receipts_processed++;

    return res.status(402).json({
      error: 'payment_required',
      message:
        'Mining work-receipt requires settlement via x402. Present X-Payment header with EIP-3009 transferWithAuthorization proof, then resubmit.',
      payment: challenge
    });
  }

  // With X-PAYMENT header — accept as settled (in production: verify on-chain)
  const receiptId = uuidv4();
  const body = req.body || {};
  const amountUsd = parseFloat(body.amount_usd) || 1.00;
  const minerDid = body.miner_did || body.did || 'unknown';
  const workHash = body.work_hash || body.proof_hash || uuidv4();

  const { spread_usd, miner_payout_usd } = spreadCalc(amountUsd);
  const settledAt = new Date().toISOString();

  stats.work_receipts_processed++;
  stats.work_receipts_settled++;
  stats.total_settled_atomic_usdc += BigInt(usdToAtomic(amountUsd));
  stats.total_spread_atomic_usdc += BigInt(usdToAtomic(spread_usd));
  if (minerDid !== 'unknown') stats.unique_mining_dids.add(minerDid);

  const record = {
    receipt_id: receiptId,
    status: 'settled',
    miner_did: minerDid,
    work_hash: workHash,
    amount_usd: amountUsd,
    spread_bps: SPREAD_BPS,
    spread_usd,
    miner_payout_usd,
    treasury: MONROE_TREASURY,
    settled_at: settledAt,
    x_payment_proof: xPayment.substring(0, 64) + '...'
  };
  settledReceipts.set(receiptId, record);

  return res.status(200).json(record);
});

// POST /v1/mdk/work-receipt/settle/:id
// Buyer presents X-PAYMENT (EIP-3009 transferWithAuthorization on Base USDC), settles to Monroe.
app.post('/v1/mdk/work-receipt/settle/:id', (req, res) => {
  const { id } = req.params;
  const xPayment = req.headers['x-payment'];

  if (!xPayment) {
    // Re-issue challenge for this specific receipt
    const pending = pendingReceipts.get(id);
    if (!pending) {
      return res.status(404).json({
        error: 'not_found',
        message: `Work-receipt ${id} not found. Submit via POST /v1/mdk/work-receipt/submit first.`
      });
    }
    return res.status(402).json({
      error: 'payment_required',
      message: 'Present X-Payment header with EIP-3009 transferWithAuthorization to settle.',
      payment: pending.challenge
    });
  }

  // Retrieve or create record
  const pending = pendingReceipts.get(id) || {};
  const body = req.body || {};
  const amountUsd = pending.amountUsd || parseFloat(body.amount_usd) || 1.00;
  const minerDid = pending.minerDid || body.miner_did || 'unknown';
  const workHash = pending.workHash || body.work_hash || uuidv4();

  if (settledReceipts.has(id)) {
    return res.status(409).json({
      error: 'already_settled',
      message: `Work-receipt ${id} has already been settled.`,
      receipt: settledReceipts.get(id)
    });
  }

  const { spread_usd, miner_payout_usd } = spreadCalc(amountUsd);
  const settledAt = new Date().toISOString();

  stats.work_receipts_settled++;
  stats.total_settled_atomic_usdc += BigInt(usdToAtomic(amountUsd));
  stats.total_spread_atomic_usdc += BigInt(usdToAtomic(spread_usd));
  if (minerDid !== 'unknown') stats.unique_mining_dids.add(minerDid);

  const record = {
    receipt_id: id,
    status: 'settled',
    miner_did: minerDid,
    work_hash: workHash,
    amount_usd: amountUsd,
    spread_bps: SPREAD_BPS,
    spread_usd,
    miner_payout_usd,
    treasury: MONROE_TREASURY,
    settled_at: settledAt,
    x_payment_proof: xPayment.substring(0, 64) + '...',
    rails: {
      chain: 'base',
      asset: 'USDC',
      contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
    }
  };

  settledReceipts.set(id, record);
  pendingReceipts.delete(id);

  return res.status(200).json(record);
});

// GET /v1/mdk/stats
app.get('/v1/mdk/stats', (req, res) => {
  res.json({
    service: SERVICE_NAME,
    work_receipts_processed: stats.work_receipts_processed,
    work_receipts_settled: stats.work_receipts_settled,
    pending_receipts: pendingReceipts.size,
    total_settled_atomic_usdc: stats.total_settled_atomic_usdc.toString(),
    total_settled_usd: (Number(stats.total_settled_atomic_usdc) / 1e6).toFixed(6),
    total_spread_atomic_usdc: stats.total_spread_atomic_usdc.toString(),
    total_spread_usd: (Number(stats.total_spread_atomic_usdc) / 1e6).toFixed(6),
    unique_mining_dids: stats.unique_mining_dids.size,
    spread_bps: SPREAD_BPS,
    treasury: MONROE_TREASURY,
    run_rate_math: {
      daily_mining_flow_usd: 660000,
      spread_pct: (SPREAD_BPS / 100).toFixed(2) + '%',
      daily_to_monroe_usd: (660000 * SPREAD_BPS) / 10000
    }
  });
});

// GET /v1/mdk/leaderboard
app.get('/v1/mdk/leaderboard', (req, res) => {
  // Build leaderboard from settled receipts
  const didVolumes = {};
  for (const [, record] of settledReceipts) {
    const did = record.miner_did || 'unknown';
    if (!didVolumes[did]) {
      didVolumes[did] = { miner_did: did, receipts_settled: 0, total_settled_usd: 0, total_payout_usd: 0 };
    }
    didVolumes[did].receipts_settled++;
    didVolumes[did].total_settled_usd = +(didVolumes[did].total_settled_usd + record.amount_usd).toFixed(6);
    didVolumes[did].total_payout_usd = +(didVolumes[did].total_payout_usd + record.miner_payout_usd).toFixed(6);
  }

  const leaderboard = Object.values(didVolumes)
    .sort((a, b) => b.total_settled_usd - a.total_settled_usd)
    .slice(0, 50)
    .map((entry, idx) => ({ rank: idx + 1, ...entry }));

  res.json({
    service: SERVICE_NAME,
    leaderboard,
    total_mining_dids: stats.unique_mining_dids.size,
    spread_bps: SPREAD_BPS,
    note: 'Top mining DIDs by settled volume. At $660K/day mining flow @ 3% spread = $19,800/day to Monroe treasury.'
  });
});

// ─── 404 fallback ────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: 'not_found',
    service: SERVICE_NAME,
    available_endpoints: [
      'GET /healthz',
      'GET /.well-known/agent.json',
      'GET /v1/mdk/rails',
      'POST /v1/mdk/work-receipt/submit',
      'POST /v1/mdk/work-receipt/settle/:id',
      'GET /v1/mdk/stats',
      'GET /v1/mdk/leaderboard'
    ]
  });
});

// ─── Start ───────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[${SERVICE_NAME}] Listening on port ${PORT}`);
  console.log(`  Treasury (EVM):   ${MONROE_TREASURY}`);
  console.log(`  Spread:           ${SPREAD_BPS}bps (${SPREAD_BPS / 100}%)`);
  console.log(`  Trust upstream:   ${HIVETRUST_URL}`);
});
