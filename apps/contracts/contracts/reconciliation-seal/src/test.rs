extern crate std;

use crate::{ReconciliationSeal, ReconciliationSealClient, SealError};
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger, MockAuth, MockAuthInvoke},
    Address, BytesN, Env, IntoVal,
};

fn setup<'a>() -> (Env, ReconciliationSealClient<'a>) {
    let env = Env::default();
    env.ledger().with_mut(|l| {
        l.sequence_number = 1_000;
        l.timestamp = 1_700_000_000;
    });
    let id = env.register(ReconciliationSeal, ());
    (env.clone(), ReconciliationSealClient::new(&env, &id))
}

fn run(env: &Env, n: u8) -> BytesN<16> {
    BytesN::from_array(env, &[n; 16])
}
fn digest(env: &Env, n: u8) -> BytesN<32> {
    BytesN::from_array(env, &[n; 32])
}

#[test]
fn seal_records_digest_ledger_and_time() {
    let (env, c) = setup();
    env.mock_all_auths();
    let sealer = Address::generate(&env);
    let s = c.seal(&sealer, &run(&env, 1), &digest(&env, 7), &42);
    // auths() and events() describe the last invocation, so check them before the next call.
    assert_eq!(env.auths()[0].0, sealer);
    assert_eq!(
        env.events()
            .all()
            .filter_by_contract(&c.address)
            .events()
            .len(),
        1
    );
    assert_eq!(
        (s.ledger, s.timestamp, s.results),
        (1_000, 1_700_000_000, 42)
    );
    assert_eq!(c.get(&sealer, &run(&env, 1)), Some(s));
}

#[test]
fn verify_detects_any_change() {
    let (env, c) = setup();
    env.mock_all_auths();
    let sealer = Address::generate(&env);
    c.seal(&sealer, &run(&env, 1), &digest(&env, 7), &1);
    assert!(c.verify(&sealer, &run(&env, 1), &digest(&env, 7)));
    assert!(!c.verify(&sealer, &run(&env, 1), &digest(&env, 8)));
    assert!(!c.verify(&sealer, &run(&env, 2), &digest(&env, 7)));
    assert!(!c.verify(&Address::generate(&env), &run(&env, 1), &digest(&env, 7)));
}

#[test]
fn seals_are_write_once() {
    let (env, c) = setup();
    env.mock_all_auths();
    let sealer = Address::generate(&env);
    c.seal(&sealer, &run(&env, 1), &digest(&env, 7), &1);
    assert_eq!(
        c.try_seal(&sealer, &run(&env, 1), &digest(&env, 9), &1),
        Err(Ok(SealError::AlreadySealed))
    );
    assert!(c.verify(&sealer, &run(&env, 1), &digest(&env, 7)));
}

#[test]
fn sealers_are_isolated() {
    let (env, c) = setup();
    env.mock_all_auths();
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    c.seal(&a, &run(&env, 1), &digest(&env, 1), &1);
    // Same run id under another sealer is a different seal and does not touch A's.
    c.seal(&b, &run(&env, 1), &digest(&env, 2), &1);
    assert!(c.verify(&a, &run(&env, 1), &digest(&env, 1)));
    assert!(c.verify(&b, &run(&env, 1), &digest(&env, 2)));
}

#[test]
#[should_panic]
fn nobody_can_seal_in_another_sealers_name() {
    let (env, c) = setup();
    let victim = Address::generate(&env);
    let attacker = Address::generate(&env);
    c.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &c.address,
            fn_name: "seal",
            args: (&victim, run(&env, 1), digest(&env, 6), 1_u32).into_val(&env),
            sub_invokes: &[],
        },
    }])
    .seal(&victim, &run(&env, 1), &digest(&env, 6), &1);
}

#[test]
fn extend_only_existing_seals() {
    let (env, c) = setup();
    env.mock_all_auths();
    let sealer = Address::generate(&env);
    assert_eq!(
        c.try_extend(&sealer, &run(&env, 1)),
        Err(Ok(SealError::NotFound))
    );
    c.seal(&sealer, &run(&env, 1), &digest(&env, 1), &1);
    c.extend(&sealer, &run(&env, 1));
}
