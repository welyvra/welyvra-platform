//! Events emitted by the vault. Welyvra's ingestion reads them to post sweeps and refunds to the
//! ledger. The first topic is the event name in snake_case (e.g. `swept`).

use soroban_sdk::{contractevent, Address, BytesN};

/// Funds moved from the vault to the treasury.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Swept {
    #[topic]
    pub token: Address,
    pub treasury: Address,
    pub amount: i128,
}

/// An unattributed deposit was returned to its sender.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Refunded {
    #[topic]
    pub deposit_ref: BytesN<32>,
    pub token: Address,
    pub to: Address,
    pub amount: i128,
}

/// A configuration value changed. `what` is one of: operator, treasury, admin, token_allowed,
/// token_disallowed, paused, unpaused.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConfigChanged {
    #[topic]
    pub what: soroban_sdk::Symbol,
    pub by: Address,
    pub value: Option<Address>,
}
