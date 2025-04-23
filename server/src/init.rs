use anyhow::{self, Context};
use anyhow::{bail, Result};
use client_sdk::transaction_builder::{ProvableBlobTx, TxExecutorHandler};
use client_sdk::{
    contract_states,
    rest_client::{IndexerApiHttpClient, NodeApiHttpClient},
    transaction_builder::TxExecutorBuilder,
};
use hyle_hydentity::Hydentity;
use hyle_hyllar::Hyllar;
use sdk::{api::APIRegisterContract, info, ContractName, ProgramId, StateCommitment};
use sdk::{Blob, BlobTransaction, Calldata, HyleOutput};
use serde::Deserialize;
use std::{sync::Arc, time::Duration};
use tokio::time::timeout;

pub struct ContractInit {
    pub name: ContractName,
    pub program_id: [u8; 32],
    pub initial_state: StateCommitment,
}

pub async fn init_node(
    node: Arc<NodeApiHttpClient>,
    indexer: Arc<IndexerApiHttpClient>,
    contracts: Vec<ContractInit>,
) -> Result<()> {
    for contract in contracts {
        init_contract(&node, contract).await?;
    }
    fund_faucet(node.clone(), indexer.clone()).await?;
    Ok(())
}

contract_states!(
    pub struct States {
        pub hyllar: Hyllar,
        pub hydentity: Hydentity,
    }
);
#[derive(Deserialize)]
struct BalanceResponse {
    balance: u128,
}

async fn fund_faucet(
    node: Arc<NodeApiHttpClient>,
    indexer: Arc<IndexerApiHttpClient>,
) -> Result<()> {
    let response = indexer
        .get::<BalanceResponse>("v1/indexer/contract/hyllar/balance/faucet")
        .await;
    if let Ok(balance) = response {
        if balance.balance > 0 {
            info!("✅ Faucet already funded with {} HYLLAR", balance.balance);
            return Ok(());
        }
    }

    info!("Funding faucet");
    let mut executor = TxExecutorBuilder::new(States {
        hyllar: indexer.fetch_current_state(&"hyllar".into()).await?,
        hydentity: indexer.fetch_current_state(&"hydentity".into()).await?,
    })
    .build();
    let mut transaction = ProvableBlobTx::new("faucet@hydentity".into());

    hyle_hydentity::client::tx_executor_handler::verify_identity(
        &mut transaction,
        "hydentity".into(),
        &executor.hydentity,
        "password".into(),
    )?;

    hyle_hyllar::client::tx_executor_handler::transfer(
        &mut transaction,
        "hyllar".into(),
        "faucet".into(),
        1_000_000_000,
    )?;

    let blob_tx = BlobTransaction::new(transaction.identity.clone(), transaction.blobs.clone());

    let tx = executor.process(transaction)?;

    node.send_tx_blob(&blob_tx)
        .await
        .context("sending tx blob")?;
    for proof in tx.iter_prove() {
        node.send_tx_proof(&proof.await?)
            .await
            .context("sending tx proof")?;
    }
    Ok(())
}

async fn init_contract(node: &NodeApiHttpClient, contract: ContractInit) -> Result<()> {
    match node.get_contract(&contract.name).await {
        Ok(existing) => {
            let onchain_program_id = hex::encode(existing.program_id.0.as_slice());
            let program_id = hex::encode(contract.program_id);
            if onchain_program_id != program_id {
                bail!(
                    "Invalid program_id for {}. On-chain version is {}, expected {}",
                    contract.name,
                    onchain_program_id,
                    program_id
                );
            }
            info!("✅ {} contract is up to date", contract.name);
        }
        Err(_) => {
            info!("🚀 Registering {} contract", contract.name);
            node.register_contract(&APIRegisterContract {
                verifier: "risc0-1".into(),
                program_id: ProgramId(contract.program_id.to_vec()),
                state_commitment: contract.initial_state,
                contract_name: contract.name.clone(),
            })
            .await?;
            wait_contract_state(node, &contract.name).await?;
        }
    }
    Ok(())
}
async fn wait_contract_state(
    node: &NodeApiHttpClient,
    contract: &ContractName,
) -> anyhow::Result<()> {
    timeout(Duration::from_secs(30), async {
        loop {
            let resp = node.get_contract(contract).await;
            if resp.is_err() {
                info!("⏰ Waiting for contract {contract} state to be ready");
                tokio::time::sleep(Duration::from_millis(500)).await;
            } else {
                return Ok(());
            }
        }
    })
    .await?
}
