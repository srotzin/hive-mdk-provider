# Release Notes — hive-mdk-provider v1.0.0

**Released:** 2026-04-28  
**Author:** Steve Rotzin <steve@thehiveryiq.com>

---

## What is this?

`hive-mdk-provider` is the first non-Tether MDK (Mining Development Kit) settlement provider for mining-side agent workloads. It mirrors the architecture of HiveCompute's QVAC SDK provider at [hivemorph.onrender.com](https://hivemorph.onrender.com) but targets Bitcoin mining workloads.

Tether released MDK on April 27, 2026 as an open-source framework (JavaScript SDK + React UI) for unified Bitcoin mining infrastructure control. Hive is the first to build a settlement *provider* layer on top of this new surface — taking the same x402 settlement pattern proven with QVAC and applying it to mining-side work-receipts.

---

## What's included

### Endpoints
- `GET /healthz` — service health
- `GET /.well-known/agent.json` — A2A agent card with Monroe treasury address
- `GET /v1/mdk/rails` — settlement rails (Base USDC/USDT, Solana USDC, Ethereum USDT)
- `POST /v1/mdk/work-receipt/submit` — submit signed proof-of-work attestation → returns 402 x402 challenge
- `POST /v1/mdk/work-receipt/settle/:id` — present X-Payment (EIP-3009) to settle; returns receipt with miner payout
- `GET /v1/mdk/stats` — counters: work-receipts processed, total settled atomic USDC, unique mining DIDs
- `GET /v1/mdk/leaderboard` — top mining DIDs by settled volume

### Settlement rails
| Chain | Asset | Contract |
|-------|-------|----------|
| Base (8453) | USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Base (8453) | USDT | `0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2` |
| Solana | USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| Ethereum (1) | USDT | `0xdAC17F958D2ee523a2206206994597C13D831ec7` |

### Treasury
- **EVM (Base + Ethereum):** `0x15184bf50b3d3f52b60434f8942b7d52f2eb436e`
- **Solana:** `B1N61cuL35fhskWz5dw8XqDyP6LWi3ZWmq8CNA9L3FVn`

---

## Take rate

**3% spread (300 bps)** — matching QVAC provider pattern.

Example: mining work-receipt for $10.00 of compute:
- Monroe receives: $0.30 (3%)
- Miner DID receives: $9.70 (97%)

---

## Run-rate math

At scale with $660K/day of mining-routed payments:
- Daily spread to Monroe: $660,000 × 3% = **$19,800/day**
- Annual run-rate: **~$7.2M/year**

---

## Why this works

1. Tether's MDK is infrastructure (monitoring, automation, hardware control) — it has no native settlement layer.
2. The x402 protocol (proven with QVAC SDK) fills that gap: miners present EIP-3009 `transferWithAuthorization` signatures for gasless USDC settlement.
3. Hive takes 3% spread on every work-receipt settled through this provider.
4. DID-based miner identity enables cross-surface loyalty (BOGO programs, referrals).

---

## Deployed

- **URL:** https://hive-mdk-provider.onrender.com
- **Registry:** https://hive-discovery.onrender.com
- **Trust:** https://hivetrust.onrender.com
