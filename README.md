# hive-mdk-provider

**Non-Tether MDK Settlement Provider** — mining-side agent workloads settle through Hive at 3% spread.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com)

## Overview

Hive is the first non-Tether MDK (Mining Development Kit) settlement provider. This service mirrors the architecture of [hivemorph](https://hivemorph.onrender.com) (QVAC settlement) but targets mining-side workloads:

- **Proof-of-compute attestation** — miners submit signed work-receipts
- **Work-receipt tokenization** — each receipt gets an x402 payment challenge
- **Mining pool coordination** — DID-based miner identity across rails
- **Settlement rails** — Base USDC/USDT (EIP-3009), Solana USDC-SPL, Ethereum USDT

**Take rate:** 3% spread (300 bps), matching QVAC provider pattern.  
**Run-rate:** $660K/day mining flow × 3% = **$19,800/day to Monroe treasury**.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/healthz` | Health check |
| `GET` | `/.well-known/agent.json` | A2A agent card |
| `GET` | `/v1/mdk/rails` | Available settlement rails |
| `POST` | `/v1/mdk/work-receipt/submit` | Submit proof-of-work attestation → 402 challenge |
| `POST` | `/v1/mdk/work-receipt/settle/:id` | Present X-Payment header to settle |
| `GET` | `/v1/mdk/stats` | Counters: receipts, volume, unique DIDs |
| `GET` | `/v1/mdk/leaderboard` | Top mining DIDs by settled volume |

## x402 Settlement Flow

```
Miner Agent                          hive-mdk-provider
    │                                       │
    │  POST /v1/mdk/work-receipt/submit     │
    │  { miner_did, work_hash, amount_usd } │
    │ ─────────────────────────────────────>│
    │                                       │
    │  402 Payment Required                 │
    │  { x402 challenge, accepts: [...] }   │
    │ <─────────────────────────────────────│
    │                                       │
    │  Sign EIP-3009 transferWithAuthorization
    │  (no gas needed — gasless USDC)       │
    │                                       │
    │  POST /v1/mdk/work-receipt/settle/:id │
    │  X-Payment: <signed-auth>             │
    │ ─────────────────────────────────────>│
    │                                       │
    │  200 OK                               │
    │  { receipt_id, miner_payout_usd,      │
    │    spread_usd, settled_at }           │
    │ <─────────────────────────────────────│
```

## Constants

- **Monroe treasury (EVM):** `0x15184bf50b3d3f52b60434f8942b7d52f2eb436e` (Base 8453 + Ethereum 1)
- **Monroe treasury (Solana):** `B1N61cuL35fhskWz5dw8XqDyP6LWi3ZWmq8CNA9L3FVn`
- **USDC (Base):** `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- **USDT (Base):** `0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2`

## Local Development

```bash
npm install
PORT=3000 node server.js
```

Test the 402 flow:

```bash
# Submit a work-receipt (expect 402)
curl -X POST http://localhost:3000/v1/mdk/work-receipt/submit \
  -H "Content-Type: application/json" \
  -d '{"miner_did":"did:web:miner.example.com","work_hash":"abc123","amount_usd":10.00}'

# Settle with payment proof
curl -X POST http://localhost:3000/v1/mdk/work-receipt/settle/<id> \
  -H "X-Payment: <eip3009-sig>"
```

## Deploy

Deployed on Render (starter plan, $7/mo):

```
https://hive-mdk-provider.onrender.com
```

## Architecture

- **Node.js + Express** — same stack as hive-meter and hive-escrow
- **In-memory state** — receipts tracked in-process (production: add Redis/Postgres)
- **x402 protocol** — EIP-3009 `transferWithAuthorization` for gasless USDC settlement
- **3% spread** — configurable via `SPREAD_BPS` env var

## License

MIT © Steve Rotzin / The Hivery IQ


---

## Hive Civilization

Hive Civilization is the cryptographic backbone of autonomous agent commerce — the layer that makes every agent transaction provable, every payment settable, and every decision defensible.

This repository is part of the **PROVABLE · SETTABLE · DEFENSIBLE** pillar.

- thehiveryiq.com
- hiveagentiq.com
- agent-card: https://hivetrust.onrender.com/.well-known/agent-card.json
