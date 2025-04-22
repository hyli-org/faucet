#![no_main]

use borsh::BorshDeserialize;
use contract1::Faucet;
use sdk::{
    guest::{GuestEnv, Risc0Env},
    utils::as_hyle_output,
    Calldata, HyleOutput, RunResult, ZkContract,
};

risc0_zkvm::guest::entry!(main);

fn main() {
    let env = Risc0Env {};
    let (commitment_metadata, calldata): (Vec<u8>, Vec<Calldata>) = env.read();

    let outputs = execute::<Faucet>(&commitment_metadata, &calldata);

    risc0_zkvm::guest::env::commit(&outputs);
}

pub fn execute<Z>(commitment_metadata: &[u8], calldata: &[Calldata]) -> Vec<HyleOutput>
where
    Z: ZkContract + BorshDeserialize + 'static,
{
    let mut contract: Z =
        borsh::from_slice(commitment_metadata).expect("Failed to decode commitment metadata");
    let mut initial_state_commitment = contract.commit();

    let mut outputs = vec![];
    for calldata in calldata.iter() {
        let mut res: RunResult = contract.execute(calldata);

        let next_state_commitment = contract.commit();

        outputs.push(as_hyle_output(
            initial_state_commitment,
            next_state_commitment.clone(),
            calldata,
            &mut res,
        ));
        initial_state_commitment = next_state_commitment;
    }
    outputs
}
