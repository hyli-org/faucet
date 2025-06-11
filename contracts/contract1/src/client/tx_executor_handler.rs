use anyhow::{Context, Result};
use client_sdk::transaction_builder::TxExecutorHandler;
use sdk::{utils::as_hyle_output, Blob, Calldata, StateCommitment, ZkContract};

use crate::Faucet;

impl TxExecutorHandler for Faucet {
    fn build_commitment_metadata(&self, _blob: &Blob) -> Result<Vec<u8>> {
        borsh::to_vec(self).context("Failed to serialize contract state")
    }

    fn handle(&mut self, calldata: &Calldata) -> Result<sdk::HyleOutput> {
        let initial_state_commitment = <Self as ZkContract>::commit(self);
        let mut res = <Self as ZkContract>::execute(self, calldata);
        let next_state_commitment = <Self as ZkContract>::commit(self);
        Ok(as_hyle_output(
            initial_state_commitment,
            next_state_commitment,
            calldata,
            &mut res,
        ))
    }

    fn get_state_commitment(&self) -> StateCommitment {
        <Self as ZkContract>::commit(self)
    }

    fn construct_state(
        _register_blob: &sdk::RegisterContractEffect,
        _metadata: &Option<Vec<u8>>,
    ) -> anyhow::Result<Self> {
        Ok(Self::default())
    }
}
