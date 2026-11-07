//! Storage layout and TTL policy.
//!
//! Instance storage holds the configuration (roles, treasury, pause flag, token allowlist). It is
//! small and read on every call. Persistent storage holds one record per refunded deposit, so a
//! deposit can never be refunded twice.
//!
//! At ~5 s per ledger there are 17_280 ledgers per day. Entries are refreshed when their TTL drops
//! below ~30 days and extended to ~180 days, so a vault used at least every ~150 days never expires.

use soroban_sdk::{contracttype, Address, BytesN, Env, Vec};

const LEDGERS_PER_DAY: u32 = 17_280;
pub const TTL_THRESHOLD: u32 = 30 * LEDGERS_PER_DAY;
pub const TTL_EXTEND_TO: u32 = 180 * LEDGERS_PER_DAY;

/// Maximum number of allowlisted tokens.
pub const MAX_TOKENS: u32 = 20;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    PendingAdmin,
    Operator,
    Treasury,
    Paused,
    AllowedTokens,
    Refund(BytesN<32>),
}

/// What was refunded for a deposit. `deposit_ref` is the key (see the contract README).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RefundRecord {
    pub token: Address,
    pub to: Address,
    pub amount: i128,
    pub ledger: u32,
}

/// Read-only snapshot of the vault configuration.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultConfig {
    pub admin: Address,
    pub operator: Address,
    pub treasury: Address,
    pub paused: bool,
    pub tokens: Vec<Address>,
}

pub fn extend_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

pub fn get<V: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>>(env: &Env, key: &DataKey) -> V {
    // Every configuration key is written by the constructor, so a missing key is a bug.
    env.storage()
        .instance()
        .get(key)
        .expect("vault configuration is set by the constructor")
}

pub fn set<V: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(env: &Env, key: &DataKey, value: &V) {
    env.storage().instance().set(key, value);
}
