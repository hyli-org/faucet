use anyhow::{Context, Result};
use app::{AppModule, AppModuleCtx};
use axum::Router;
use client_sdk::rest_client::NodeApiHttpClient;
use config::File;
use contract1::Faucet;
use contracts::CONTRACT_ELF;
use hyle_modules::{
    bus::{metrics::BusMetrics, SharedMessageBus},
    modules::{
        contract_state_indexer::{ContractStateIndexer, ContractStateIndexerCtx},
        da_listener::{DAListener, DAListenerConf},
        prover::{AutoProver, AutoProverCtx},
        rest::{RestApi, RestApiRunContext},
        BuildApiContextInner, ModulesHandler,
    },
    utils::logger::setup_tracing,
};
use indexer::FaucetCustomState;
use prometheus::Registry;
use sdk::{api::NodeInfo, info, ContractName, ZkContract};
use sp1_sdk::{Prover, SP1ProvingKey};
use std::{
    collections::HashMap,
    env,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tracing::error;

mod app;
mod indexer;
mod init;

#[derive(serde::Deserialize, Debug)]
pub struct Conf {
    pub id: String,
    pub log_format: String,
    pub data_directory: PathBuf,
    pub rest_server_port: u16,
    pub rest_server_max_body_size: usize,
    pub da_read_from: String,
    pub contract_name: String,
    pub buffer_blocks: u32,
    pub max_txs_per_proof: usize,
    pub tx_working_window_size: usize,
}

#[tokio::main]
async fn main() -> Result<()> {
    let config: Conf = config::Config::builder()
        .add_source(File::from_str(
            include_str!("../../config.toml"),
            config::FileFormat::Toml,
        ))
        .add_source(config::Environment::with_prefix("FAUCET"))
        .build()
        .unwrap()
        .try_deserialize()?;

    setup_tracing(
        &config.log_format,
        format!("{}(nopkey)", config.id.clone(),),
    )
    .context("setting up tracing")?;

    let config = Arc::new(config);

    let contract_name: ContractName = config.contract_name.clone().into();

    info!("Starting app with config: {:?}", &config);

    let node_url = env::var("NODE_URL").unwrap_or_else(|_| "http://localhost:4321".to_string());
    let node_client = Arc::new(NodeApiHttpClient::new(node_url).context("build node client")?);

    let pk = load_pk(&config.data_directory);
    let prover = client_sdk::helpers::sp1::SP1Prover::new(pk).await;

    info!("Init contract on node");
    let contracts = vec![init::ContractInit {
        name: contract_name.clone(),
        program_id: prover.program_id().expect("getting program id").0,
        initial_state: Faucet::default().commit(),
    }];

    match init::init_node(node_client.clone(), contracts).await {
        Ok(_) => {}
        Err(e) => {
            error!("Error initializing node: {:?}", e);
            return Ok(());
        }
    }
    let bus = SharedMessageBus::new(BusMetrics::global(config.id.clone()));

    std::fs::create_dir_all(&config.data_directory).context("creating data directory")?;

    let registry = Registry::new();
    // Init global metrics meter we expose as an endpoint
    let provider = opentelemetry_sdk::metrics::SdkMeterProvider::builder()
        .with_reader(
            opentelemetry_prometheus::exporter()
                .with_registry(registry.clone())
                .build()
                .context("starting prometheus exporter")?,
        )
        .build();

    opentelemetry::global::set_meter_provider(provider.clone());

    let mut handler = ModulesHandler::new(&bus).await;

    let api = Arc::new(BuildApiContextInner {
        router: Mutex::new(Some(Router::new())),
        openapi: Default::default(),
    });

    let app_ctx = Arc::new(AppModuleCtx {
        api: api.clone(),
        node_client,
        faucet_cn: contract_name.clone(),
    });

    let prover_ctx = Arc::new(AutoProverCtx {
        prover: Arc::new(prover),
        contract_name: contract_name.clone(),
        node: app_ctx.node_client.clone(),
        api: Some(api.clone()),
        data_directory: config.data_directory.clone(),
        default_state: Default::default(),
        buffer_blocks: config.buffer_blocks,
        max_txs_per_proof: config.max_txs_per_proof,
        tx_working_window_size: config.tx_working_window_size,
    });

    handler.build_module::<AppModule>(app_ctx.clone()).await?;

    handler
        .build_module::<ContractStateIndexer<FaucetCustomState>>(ContractStateIndexerCtx {
            contract_name,
            data_directory: config.data_directory.clone(),
            api: api.clone(),
        })
        .await?;

    handler
        .build_module::<AutoProver<Faucet>>(prover_ctx.clone())
        .await?;

    // This module connects to the da_address and receives all the blocks²
    handler
        .build_module::<DAListener>(DAListenerConf {
            data_directory: config.data_directory.clone(),
            da_read_from: config.da_read_from.clone(),
            timeout_client_secs: 10,
            start_block: None,
        })
        .await?;

    // Should come last so the other modules have nested their own routes.
    #[allow(clippy::expect_used, reason = "Fail on misconfiguration")]
    let router = api
        .router
        .lock()
        .expect("Context router should be available")
        .take()
        .expect("Context router should be available");

    handler
        .build_module::<RestApi>(RestApiRunContext {
            port: config.rest_server_port,
            max_body_size: config.rest_server_max_body_size,
            registry,
            router: router.clone(),
            openapi: Default::default(),
            info: NodeInfo {
                id: config.id.clone(),
                da_address: config.da_read_from.clone(),
                pubkey: None,
            },
        })
        .await?;

    handler.start_modules().await?;
    handler.exit_process().await?;

    Ok(())
}

pub fn load_pk(data_directory: &Path) -> SP1ProvingKey {
    let pk_path = data_directory.join("proving_key.bin");

    if pk_path.exists() {
        info!("Loading proving key from disk");
        return std::fs::read(&pk_path)
            .map(|bytes| bincode::deserialize(&bytes).expect("Failed to deserialize proving key"))
            .expect("Failed to read proving key from disk");
    } else if let Err(e) = std::fs::create_dir_all(data_directory) {
        error!("Failed to create data directory: {}", e);
    }

    info!("Building proving key");
    let client = sp1_sdk::ProverClient::builder().cpu().build();
    let (pk, _) = client.setup(CONTRACT_ELF);

    if let Err(e) = std::fs::write(
        &pk_path,
        bincode::serialize(&pk).expect("Failed to serialize proving key"),
    ) {
        error!("Failed to save proving key to disk: {}", e);
    }

    pk
}
