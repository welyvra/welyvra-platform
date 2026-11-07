use soroban_sdk::contracterror;

/// Every way a vault call can be refused. Codes are stable: clients map them by number.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VaultError {
    /// The token is not on the vault's allowlist.
    TokenNotAllowed = 1,
    /// Amounts must be strictly positive.
    InvalidAmount = 2,
    /// Outgoing transfers are paused.
    Paused = 3,
    /// This deposit was already refunded; a deposit can be refunded at most once.
    AlreadyRefunded = 4,
    /// `accept_admin` was called with no pending admin.
    NoPendingAdmin = 5,
    /// The allowlist is capped to keep instance storage small.
    TooManyTokens = 6,
    /// The caller is neither the admin nor the operator.
    Unauthorized = 7,
}
