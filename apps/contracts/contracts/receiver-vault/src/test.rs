extern crate std;

use crate::{ReceiverVault, ReceiverVaultClient, VaultError};
use soroban_sdk::{
    testutils::{Address as _, Events as _, MockAuth, MockAuthInvoke},
    token::{StellarAssetClient, TokenClient},
    vec, Address, BytesN, Env, IntoVal,
};

struct Setup<'a> {
    env: Env,
    vault: ReceiverVaultClient<'a>,
    token: TokenClient<'a>,
    admin: Address,
    operator: Address,
    treasury: Address,
}

/// A vault holding 1_000 units of an allowlisted Stellar asset.
fn setup<'a>() -> Setup<'a> {
    let env = Env::default();
    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    let treasury = Address::generate(&env);
    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let id = env.register(
        ReceiverVault,
        (&admin, &operator, &treasury, vec![&env, sac.address()]),
    );
    env.mock_all_auths();
    StellarAssetClient::new(&env, &sac.address()).mint(&id, &1_000);
    Setup {
        vault: ReceiverVaultClient::new(&env, &id),
        token: TokenClient::new(&env, &sac.address()),
        env,
        admin,
        operator,
        treasury,
    }
}

fn deposit_ref(env: &Env, n: u8) -> BytesN<32> {
    BytesN::from_array(env, &[n; 32])
}

#[test]
fn constructor_stores_config_and_dedupes_tokens() {
    let s = setup();
    let c = s.vault.config();
    assert_eq!(c.admin, s.admin);
    assert_eq!(c.operator, s.operator);
    assert_eq!(c.treasury, s.treasury);
    assert!(!c.paused);
    assert_eq!(c.tokens, vec![&s.env, s.token.address.clone()]);

    let env = Env::default();
    let a = Address::generate(&env);
    let t = Address::generate(&env);
    let id = env.register(
        ReceiverVault,
        (&a, &a, &a, vec![&env, t.clone(), t.clone()]),
    );
    assert_eq!(ReceiverVaultClient::new(&env, &id).config().tokens.len(), 1);
}

#[test]
fn sweep_moves_funds_to_the_treasury_only() {
    let s = setup();
    s.vault.sweep(&s.token.address, &400);
    assert_eq!(s.token.balance(&s.treasury), 400);
    assert_eq!(s.token.balance(&s.vault.address), 600);
}

#[test]
fn sweep_requires_the_operator_signature() {
    let s = setup();
    s.vault.sweep(&s.token.address, &1);
    // The only authorization recorded is the operator's, for exactly this call.
    let auths = s.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, s.operator);
}

#[test]
#[should_panic]
fn sweep_signed_by_someone_else_is_rejected() {
    let s = setup();
    let thief = Address::generate(&s.env);
    s.vault
        .mock_auths(&[MockAuth {
            address: &thief,
            invoke: &MockAuthInvoke {
                contract: &s.vault.address,
                fn_name: "sweep",
                args: (&s.token.address, 1_i128).into_val(&s.env),
                sub_invokes: &[],
            },
        }])
        .sweep(&s.token.address, &1);
}

#[test]
fn sweep_rejects_bad_amounts_unknown_tokens_and_overdrafts() {
    let s = setup();
    assert_eq!(
        s.vault.try_sweep(&s.token.address, &0),
        Err(Ok(VaultError::InvalidAmount))
    );
    assert_eq!(
        s.vault.try_sweep(&s.token.address, &-5),
        Err(Ok(VaultError::InvalidAmount))
    );
    let other = Address::generate(&s.env);
    assert_eq!(
        s.vault.try_sweep(&other, &1),
        Err(Ok(VaultError::TokenNotAllowed))
    );
    // More than the balance: the token contract fails and nothing moves.
    assert!(s.vault.try_sweep(&s.token.address, &1_001).is_err());
    assert_eq!(s.token.balance(&s.vault.address), 1_000);
}

#[test]
fn refund_returns_a_deposit_exactly_once() {
    let s = setup();
    let sender = Address::generate(&s.env);
    let r = deposit_ref(&s.env, 1);
    s.vault.refund(&s.token.address, &sender, &250, &r);
    assert_eq!(s.token.balance(&sender), 250);
    let record = s.vault.refund_of(&r).unwrap();
    assert_eq!((record.to, record.amount), (sender.clone(), 250));

    assert_eq!(
        s.vault.try_refund(&s.token.address, &sender, &250, &r),
        Err(Ok(VaultError::AlreadyRefunded))
    );
    assert_eq!(s.token.balance(&sender), 250);
    assert_eq!(s.vault.refund_of(&deposit_ref(&s.env, 2)), None);
}

#[test]
fn refund_requires_the_admin_not_the_operator() {
    let s = setup();
    let sender = Address::generate(&s.env);
    s.vault
        .refund(&s.token.address, &sender, &1, &deposit_ref(&s.env, 1));
    assert_eq!(s.env.auths()[0].0, s.admin);
}

#[test]
#[should_panic]
fn operator_cannot_refund_to_an_address_of_its_choice() {
    let s = setup();
    let accomplice = Address::generate(&s.env);
    let r = deposit_ref(&s.env, 9);
    s.vault
        .mock_auths(&[MockAuth {
            address: &s.operator,
            invoke: &MockAuthInvoke {
                contract: &s.vault.address,
                fn_name: "refund",
                args: (&s.token.address, &accomplice, 500_i128, &r).into_val(&s.env),
                sub_invokes: &[],
            },
        }])
        .refund(&s.token.address, &accomplice, &500, &r);
}

#[test]
fn a_failed_refund_leaves_no_record() {
    let s = setup();
    let sender = Address::generate(&s.env);
    let r = deposit_ref(&s.env, 3);
    assert!(s
        .vault
        .try_refund(&s.token.address, &sender, &5_000, &r)
        .is_err());
    assert_eq!(s.vault.refund_of(&r), None);
    s.vault.refund(&s.token.address, &sender, &10, &r);
}

#[test]
fn pause_stops_all_outflows_until_the_admin_unpauses() {
    let s = setup();
    s.vault.pause(&s.operator);
    let sender = Address::generate(&s.env);
    assert_eq!(
        s.vault.try_sweep(&s.token.address, &1),
        Err(Ok(VaultError::Paused))
    );
    assert_eq!(
        s.vault
            .try_refund(&s.token.address, &sender, &1, &deposit_ref(&s.env, 1)),
        Err(Ok(VaultError::Paused))
    );
    s.vault.unpause();
    assert_eq!(s.env.auths()[0].0, s.admin);
    s.vault.sweep(&s.token.address, &1);
}

#[test]
fn strangers_cannot_pause() {
    let s = setup();
    let stranger = Address::generate(&s.env);
    assert_eq!(
        s.vault.try_pause(&stranger),
        Err(Ok(VaultError::Unauthorized))
    );
}

#[test]
fn admin_changes_treasury_operator_and_tokens() {
    let s = setup();
    let new_treasury = Address::generate(&s.env);
    s.vault.set_treasury(&new_treasury);
    assert_eq!(s.env.auths()[0].0, s.admin);
    s.vault.sweep(&s.token.address, &7);
    assert_eq!(s.token.balance(&new_treasury), 7);

    let new_operator = Address::generate(&s.env);
    s.vault.set_operator(&new_operator);
    s.vault.sweep(&s.token.address, &1);
    assert_eq!(s.env.auths()[0].0, new_operator);

    s.vault.disallow_token(&s.token.address);
    assert_eq!(
        s.vault.try_sweep(&s.token.address, &1),
        Err(Ok(VaultError::TokenNotAllowed))
    );
    s.vault.allow_token(&s.token.address);
    s.vault.allow_token(&s.token.address); // idempotent
    assert_eq!(s.vault.config().tokens.len(), 1);
}

#[test]
fn the_allowlist_is_capped() {
    let s = setup();
    for _ in 1..crate::storage::MAX_TOKENS {
        s.vault.allow_token(&Address::generate(&s.env));
    }
    assert_eq!(
        s.vault.try_allow_token(&Address::generate(&s.env)),
        Err(Ok(VaultError::TooManyTokens))
    );
}

#[test]
fn admin_transfer_takes_two_steps() {
    let s = setup();
    assert_eq!(
        s.vault.try_accept_admin(),
        Err(Ok(VaultError::NoPendingAdmin))
    );
    let new_admin = Address::generate(&s.env);
    s.vault.propose_admin(&new_admin);
    assert_eq!(s.vault.config().admin, s.admin); // not yet
    s.vault.accept_admin();
    assert_eq!(s.env.auths()[0].0, new_admin);
    assert_eq!(s.vault.config().admin, new_admin);
    assert_eq!(
        s.vault.try_accept_admin(),
        Err(Ok(VaultError::NoPendingAdmin))
    );
}

#[test]
fn sweeps_and_refunds_emit_events() {
    let s = setup();
    s.vault.sweep(&s.token.address, &1);
    assert_eq!(
        s.env
            .events()
            .all()
            .filter_by_contract(&s.vault.address)
            .events()
            .len(),
        1
    );
    let sender = Address::generate(&s.env);
    s.vault
        .refund(&s.token.address, &sender, &1, &deposit_ref(&s.env, 4));
    assert_eq!(
        s.env
            .events()
            .all()
            .filter_by_contract(&s.vault.address)
            .events()
            .len(),
        1
    );
}
