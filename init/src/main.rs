use anyhow::Result;
use anyhow::{self, Context};
use client_sdk::transaction_builder::{ProvableBlobTx, TxExecutorHandler};
use client_sdk::{
    contract_states,
    rest_client::{IndexerApiHttpClient, NodeApiHttpClient},
    transaction_builder::TxExecutorBuilder,
};
use hyle_hydentity::Hydentity;
use hyle_smt_token::account::{Account, AccountSMT};
use sdk::{info, ContractName};
use sdk::{Blob, BlobTransaction, Calldata, HyleOutput};
use serde::Deserialize;
use std::collections::HashMap;
use std::env;
use std::sync::Arc;

#[tokio::main]
async fn main() -> Result<()> {
    let node_url = env::var("NODE_URL").unwrap_or_else(|_| "http://localhost:4321".to_string());
    let indexer_url =
        env::var("INDEXER_URL").unwrap_or_else(|_| "http://localhost:4321".to_string());
    let node_client = Arc::new(NodeApiHttpClient::new(node_url).context("build node client")?);
    let indexer_client =
        Arc::new(IndexerApiHttpClient::new(indexer_url).context("build indexer client")?);

    fund_faucet(node_client.clone(), indexer_client.clone()).await
}

contract_states!(
    pub struct States {
        pub oranj: AccountSMT,
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
        .get::<BalanceResponse>("v1/indexer/contract/oranj/balance/faucet")
        .await;
    if let Ok(balance) = response {
        if balance.balance > 0 {
            info!("✅ Faucet already funded with {} ORANJ", balance.balance);
            return Ok(());
        }
    }

    info!("Funding faucet");
    let api: HashMap<String, Account> = indexer.fetch_current_state(&"oranj".into()).await?;
    let mut oranj = AccountSMT::default();
    for (id, account) in api.into_iter() {
        info!("Funding account {}", id);
        oranj.0.update(account.get_key(), account)?;
    }

    let mut executor = TxExecutorBuilder::new(States {
        oranj,
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

    executor.oranj.transfer(
        &mut transaction,
        "oranj".into(),
        "faucet@hydentity".into(),
        "faucet".into(),
        1_000_000_000,
    )?;

    let blob_tx = BlobTransaction::new(transaction.identity.clone(), transaction.blobs.clone());

    let tx = executor.process(transaction)?;

    node.send_tx_blob(&blob_tx)
        .await
        .context("sending tx blob")?;
    for proof in tx.iter_prove() {
        info!("⏳ Waiting for tx proof");
        node.send_tx_proof(&proof.await?)
            .await
            .context("sending tx proof")?;
    }
    Ok(())
}
