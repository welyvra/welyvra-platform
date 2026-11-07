#![no_std]
//! # Receiver vault
//!
//! A business's receiving account on Stellar. Customers pay to the vault's muxed `W` address
//! (Protocol 30, CAP-84); the muxed ID in each transfer event tells Welyvra which customer paid.
//! The vault then lets the business move those funds out in exactly two ways:
//!
//! - **sweep**: the operator (an automated key) sends funds to the treasury. The destination is
//!   fixed by the admin, so a leaked operator key cannot send money anywhere else.
//! - **refund**: the admin returns an unattributed deposit to its sender, at most once per deposit.
//!
//! The admin is the business, never Welyvra: Welyvra holds no keys that can move funds to an
//! arbitrary address. The vault cannot reject incoming transfers (Soroban tokens do not call the
//! recipient), so unknown or unwanted deposits are surfaced off-chain and refunded here.
//!
//! The contract is not upgradeable. A fix means deploying a new vault and sweeping to it.

mod errors;
mod events;
mod storage;

#[cfg(test)]
mod test;

pub use errors::VaultError;
pub use storage::{RefundRecord, VaultConfig};

use events::{ConfigChanged, Refunded, Swept};
use soroban_sdk::{contract, contractimpl, symbol_short, token, Address, BytesN, Env, Symbol, Vec};
use storage::{extend_instance, get, set, DataKey, MAX_TOKENS, TTL_EXTEND_TO, TTL_THRESHOLD};

#[contract]
pub struct ReceiverVault;

#[contractimpl]
impl ReceiverVault {
    /// Runs once, atomically with deployment, so nobody can front-run initialization.
    pub fn __constructor(
        env: Env,
        admin: Address,
        operator: Address,
        treasury: Address,
        tokens: Vec<Address>,
    ) -> Result<(), VaultError> {
        let mut allowed: Vec<Address> = Vec::new(&env);
        for t in tokens.iter() {
            if !allowed.contains(&t) {
                allowed.push_back(t);
            }
        }
        if allowed.len() > MAX_TOKENS {
            return Err(VaultError::TooManyTokens);
        }
        set(&env, &DataKey::Admin, &admin);
        set(&env, &DataKey::Operator, &operator);
        set(&env, &DataKey::Treasury, &treasury);
        set(&env, &DataKey::Paused, &false);
        set(&env, &DataKey::AllowedTokens, &allowed);
        extend_instance(&env);
        Ok(())
    }

    // ---------------------------------------------------------------- moving funds

    /// Operator only. Sends `amount` of `token` from the vault to the treasury.
    pub fn sweep(env: Env, token: Address, amount: i128) -> Result<(), VaultError> {
        get::<Address>(&env, &DataKey::Operator).require_auth();
        ensure_can_move(&env, &token, amount)?;
        let treasury: Address = get(&env, &DataKey::Treasury);
        token::Client::new(&env, &token).transfer(
            &env.current_contract_address(),
            &treasury,
            &amount,
        );
        Swept {
            token,
            treasury,
            amount,
        }
        .publish(&env);
        extend_instance(&env);
        Ok(())
    }

    /// Admin only. Returns an unattributed deposit to `to`. `deposit_ref` identifies the deposit
    /// (SHA-256 of its network and event ID); the same deposit can never be refunded twice.
    pub fn refund(
        env: Env,
        token: Address,
        to: Address,
        amount: i128,
        deposit_ref: BytesN<32>,
    ) -> Result<(), VaultError> {
        get::<Address>(&env, &DataKey::Admin).require_auth();
        ensure_can_move(&env, &token, amount)?;
        let key = DataKey::Refund(deposit_ref.clone());
        let persistent = env.storage().persistent();
        if persistent.has(&key) {
            return Err(VaultError::AlreadyRefunded);
        }
        // Record first, then transfer: the record and the transfer commit or fail together.
        let record = RefundRecord {
            token: token.clone(),
            to: to.clone(),
            amount,
            ledger: env.ledger().sequence(),
        };
        persistent.set(&key, &record);
        persistent.extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        token::Client::new(&env, &token).transfer(&env.current_contract_address(), &to, &amount);
        Refunded {
            deposit_ref,
            token,
            to,
            amount,
        }
        .publish(&env);
        extend_instance(&env);
        Ok(())
    }

    // ---------------------------------------------------------------- safety switch

    /// Admin or operator. Stops sweeps and refunds until the admin unpauses.
    pub fn pause(env: Env, caller: Address) -> Result<(), VaultError> {
        caller.require_auth();
        let admin: Address = get(&env, &DataKey::Admin);
        let operator: Address = get(&env, &DataKey::Operator);
        if caller != admin && caller != operator {
            return Err(VaultError::Unauthorized);
        }
        set(&env, &DataKey::Paused, &true);
        changed(&env, symbol_short!("paused"), caller, None);
        Ok(())
    }

    /// Admin only.
    pub fn unpause(env: Env) {
        let admin = require_admin(&env);
        set(&env, &DataKey::Paused, &false);
        changed(&env, symbol_short!("unpaused"), admin, None);
    }

    // ---------------------------------------------------------------- configuration (admin)

    pub fn set_operator(env: Env, operator: Address) {
        let admin = require_admin(&env);
        set(&env, &DataKey::Operator, &operator);
        changed(&env, symbol_short!("operator"), admin, Some(operator));
    }

    pub fn set_treasury(env: Env, treasury: Address) {
        let admin = require_admin(&env);
        set(&env, &DataKey::Treasury, &treasury);
        changed(&env, symbol_short!("treasury"), admin, Some(treasury));
    }

    pub fn allow_token(env: Env, token: Address) -> Result<(), VaultError> {
        let admin = require_admin(&env);
        let mut tokens: Vec<Address> = get(&env, &DataKey::AllowedTokens);
        if !tokens.contains(&token) {
            if tokens.len() >= MAX_TOKENS {
                return Err(VaultError::TooManyTokens);
            }
            tokens.push_back(token.clone());
            set(&env, &DataKey::AllowedTokens, &tokens);
        }
        changed(&env, Symbol::new(&env, "token_allowed"), admin, Some(token));
        Ok(())
    }

    pub fn disallow_token(env: Env, token: Address) {
        let admin = require_admin(&env);
        let mut tokens: Vec<Address> = get(&env, &DataKey::AllowedTokens);
        if let Some(i) = tokens.first_index_of(&token) {
            tokens.remove(i);
            set(&env, &DataKey::AllowedTokens, &tokens);
        }
        changed(
            &env,
            Symbol::new(&env, "token_disallowed"),
            admin,
            Some(token),
        );
    }

    /// Step 1 of 2 of an admin change. Two steps, so a typo cannot lock the vault forever.
    pub fn propose_admin(env: Env, new_admin: Address) {
        require_admin(&env);
        set(&env, &DataKey::PendingAdmin, &new_admin);
        extend_instance(&env);
    }

    /// Step 2 of 2: the proposed admin accepts, proving it controls the new key.
    pub fn accept_admin(env: Env) -> Result<(), VaultError> {
        let pending: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .ok_or(VaultError::NoPendingAdmin)?;
        pending.require_auth();
        set(&env, &DataKey::Admin, &pending);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        changed(&env, symbol_short!("admin"), pending.clone(), Some(pending));
        Ok(())
    }

    // ---------------------------------------------------------------- reads

    pub fn config(env: Env) -> VaultConfig {
        VaultConfig {
            admin: get(&env, &DataKey::Admin),
            operator: get(&env, &DataKey::Operator),
            treasury: get(&env, &DataKey::Treasury),
            paused: get(&env, &DataKey::Paused),
            tokens: get(&env, &DataKey::AllowedTokens),
        }
    }

    pub fn refund_of(env: Env, deposit_ref: BytesN<32>) -> Option<RefundRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::Refund(deposit_ref))
    }
}

fn require_admin(env: &Env) -> Address {
    let admin: Address = get(env, &DataKey::Admin);
    admin.require_auth();
    admin
}

fn ensure_can_move(env: &Env, token: &Address, amount: i128) -> Result<(), VaultError> {
    if get::<bool>(env, &DataKey::Paused) {
        return Err(VaultError::Paused);
    }
    if amount <= 0 {
        return Err(VaultError::InvalidAmount);
    }
    if !get::<Vec<Address>>(env, &DataKey::AllowedTokens).contains(token) {
        return Err(VaultError::TokenNotAllowed);
    }
    Ok(())
}

fn changed(env: &Env, what: Symbol, by: Address, value: Option<Address>) {
    ConfigChanged { what, by, value }.publish(env);
    extend_instance(env);
}
