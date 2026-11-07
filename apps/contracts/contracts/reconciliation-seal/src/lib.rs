#![no_std]
//! # Reconciliation seal
//!
//! Publishes a tamper-evident fingerprint of each reconciliation run. After Welyvra reconciles a
//! business's deposits, the business (the "sealer") signs and records the SHA-256 digest of the run
//! here. Later, anyone holding the run's data (an auditor, a partner) can recompute the digest and
//! call `verify`: if a single result was changed afterwards, the digests no longer match.
//!
//! - Seals are write-once: a sealed run can never be overwritten or deleted.
//! - Seals are namespaced by sealer: one business cannot write or shadow another's seals.
//! - There is no admin and no upgrade path, so nobody, Welyvra included, can alter history.
//!
//! The digest format is specified in the contract README (docs: `apps/contracts/README.md`).
//! Entries live in persistent storage with a ~180 day TTL, extended on every read through
//! `extend`. An expired entry is archived, not lost: it can be restored on-chain.

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, BytesN, Env,
};

const LEDGERS_PER_DAY: u32 = 17_280;
const TTL_THRESHOLD: u32 = 30 * LEDGERS_PER_DAY;
const TTL_EXTEND_TO: u32 = 180 * LEDGERS_PER_DAY;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum SealError {
    /// This run is already sealed by this sealer. Seals are write-once.
    AlreadySealed = 1,
    /// No seal exists for this sealer and run.
    NotFound = 2,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Seal(Address, BytesN<16>),
}

/// A recorded seal. `ledger` and `timestamp` prove when it was written.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Seal {
    pub digest: BytesN<32>,
    /// Number of results covered by the digest, for a quick sanity check.
    pub results: u32,
    pub ledger: u32,
    pub timestamp: u64,
}

/// Emitted once per seal. Welyvra links it to the run in its audit log.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Sealed {
    #[topic]
    pub sealer: Address,
    #[topic]
    pub run_id: BytesN<16>,
    pub digest: BytesN<32>,
    pub results: u32,
}

#[contract]
pub struct ReconciliationSeal;

#[contractimpl]
impl ReconciliationSeal {
    /// Records the digest of reconciliation run `run_id` (the run's UUID as 16 bytes).
    /// Requires the sealer's signature.
    pub fn seal(
        env: Env,
        sealer: Address,
        run_id: BytesN<16>,
        digest: BytesN<32>,
        results: u32,
    ) -> Result<Seal, SealError> {
        sealer.require_auth();
        let key = DataKey::Seal(sealer.clone(), run_id.clone());
        let storage = env.storage().persistent();
        if storage.has(&key) {
            return Err(SealError::AlreadySealed);
        }
        let seal = Seal {
            digest: digest.clone(),
            results,
            ledger: env.ledger().sequence(),
            timestamp: env.ledger().timestamp(),
        };
        storage.set(&key, &seal);
        storage.extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        Sealed {
            sealer,
            run_id,
            digest,
            results,
        }
        .publish(&env);
        Ok(seal)
    }

    pub fn get(env: Env, sealer: Address, run_id: BytesN<16>) -> Option<Seal> {
        env.storage()
            .persistent()
            .get(&DataKey::Seal(sealer, run_id))
    }

    /// True only if this sealer sealed this run with exactly this digest.
    pub fn verify(env: Env, sealer: Address, run_id: BytesN<16>, digest: BytesN<32>) -> bool {
        Self::get(env, sealer, run_id).is_some_and(|s| s.digest == digest)
    }

    /// Anyone may pay to keep a seal from being archived (no state changes besides its TTL).
    pub fn extend(env: Env, sealer: Address, run_id: BytesN<16>) -> Result<(), SealError> {
        let key = DataKey::Seal(sealer, run_id);
        let storage = env.storage().persistent();
        if !storage.has(&key) {
            return Err(SealError::NotFound);
        }
        storage.extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        Ok(())
    }
}
