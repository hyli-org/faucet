use anyhow::Result;
use anyhow::{self, Context};
use client_sdk::transaction_builder::{ProvableBlobTx, TxExecutorHandler};
use client_sdk::{
    contract_states,
    rest_client::{IndexerApiHttpClient, NodeApiClient, NodeApiHttpClient},
    transaction_builder::TxExecutorBuilder,
};
use hyle_hydentity::Hydentity;
use hyle_smt_token::account::{Account, AccountSMT};
use sdk::{info, ContractName};
use sdk::{Blob, BlobTransaction, Calldata, HyleOutput};
use std::collections::HashMap;
use std::env;
use std::sync::Arc;

#[tokio::main]
async fn main() -> Result<()> {
    // Read first arg
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: {} <address> [amount]", args[0]);
        std::process::exit(1);
    }
    let address = args[1].clone();
    let amount: u128 = if args.len() > 2 {
        args[2].parse().unwrap_or_else(|_| {
            eprintln!("Invalid amount: {}", args[2]);
            std::process::exit(1);
        })
    } else {
        1_000_000_000 // Default amount
    };

    tracing_subscriber::fmt().init();

    let node_url = env::var("NODE_URL").unwrap_or_else(|_| "http://localhost:4321".to_string());
    let indexer_url =
        env::var("INDEXER_URL").unwrap_or_else(|_| "http://localhost:4321".to_string());
    let node_client = Arc::new(NodeApiHttpClient::new(node_url).context("build node client")?);
    let indexer_client =
        Arc::new(IndexerApiHttpClient::new(indexer_url).context("build indexer client")?);

    fund_address(
        &address,
        amount,
        node_client.clone(),
        indexer_client.clone(),
    )
    .await
}

contract_states!(
    pub struct States {
        pub oranj: AccountSMT,
        pub hydentity: Hydentity,
    }
);

async fn fund_address(
    address: &str,
    amount: u128,
    node: Arc<NodeApiHttpClient>,
    indexer: Arc<IndexerApiHttpClient>,
) -> Result<()> {
    info!("Funding {address}");
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
        address.into(),
        amount,
    )?;

    let blob_tx = BlobTransaction::new(transaction.identity.clone(), transaction.blobs.clone());

    let tx = executor.process(transaction)?;

    node.send_tx_blob(blob_tx)
        .await
        .context("sending tx blob")?;
    for proof in tx.iter_prove() {
        info!("⏳ Waiting for tx proof");
        node.send_tx_proof(proof.await?)
            .await
            .context("sending tx proof")?;
    }
    Ok(())
}
