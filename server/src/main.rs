use anyhow::{Context, Result};
use app::{AppModule, AppModuleCtx};
use axum::Router;
use borsh::BorshSerialize;
use client_sdk::{helpers::ClientSdkProver, rest_client::NodeApiHttpClient};
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
use prometheus::Registry;
use sdk::{api::NodeInfo, info, ContractName, ProofData, ZkContract};
use sp1_sdk::{
    network::builder::NetworkProverBuilder, NetworkProver, Prover, SP1Prover, SP1ProvingKey,
    SP1Stdin,
};
use std::{
    env,
    path::PathBuf,
    pin::Pin,
    sync::{Arc, Mutex},
};
use tracing::error;

mod app;
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

    info!("Building Proving Key");
    let prover = client_sdk::helpers::sp1::SP1Prover::new(CONTRACT_ELF);

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
    let start_height = app_ctx.node_client.get_block_height().await?;
    let prover_ctx = Arc::new(AutoProverCtx {
        start_height,
        prover: Arc::new(prover),
        contract_name: contract_name.clone(),
        node: app_ctx.node_client.clone(),
        data_directory: config.data_directory.clone(),
        default_state: Default::default(),
    });

    handler.build_module::<AppModule>(app_ctx.clone()).await?;

    handler
        .build_module::<ContractStateIndexer<Faucet>>(ContractStateIndexerCtx {
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
            registry: Registry::new(),
            router: router.clone(),
            openapi: Default::default(),
            info: NodeInfo {
                id: config.id.clone(),
                da_address: config.da_read_from.clone(),
                pubkey: None,
            },
        })
        .await?;

    #[cfg(unix)]
    {
        use tokio::signal::unix;
        let mut terminate = unix::signal(unix::SignalKind::interrupt())?;
        tokio::select! {
            Err(e) = handler.start_modules() => {
                error!("Error running modules: {:?}", e);
            }
            _ = tokio::signal::ctrl_c() => {
                info!("Ctrl-C received, shutting down");
            }
            _ = terminate.recv() =>  {
                info!("SIGTERM received, shutting down");
            }
        }
        _ = handler.shutdown_modules().await;
    }
    #[cfg(not(unix))]
    {
        tokio::select! {
            Err(e) = handler.start_modules() => {
                error!("Error running modules: {:?}", e);
            }
            _ = tokio::signal::ctrl_c() => {
                info!("Ctrl-C received, shutting down");
            }
        }
        _ = handler.shutdown_modules().await;
    }

    Ok(())
}

pub fn load_pk() -> SP1ProvingKey {
    let client = sp1_sdk::ProverClient::builder().mock().build();
    let (pk, _) = client.setup(contracts::CONTRACT_ELF);
    pk
}

pub struct SP1NetworkProver {
    pk: SP1ProvingKey,
    client: NetworkProver,
}
impl SP1NetworkProver {
    pub async fn new(pk: SP1ProvingKey) -> Self {
        // Setup the program for proving.
        let client = NetworkProverBuilder::default().build();
        info!("Registering program");
        client
            .register_program(&pk.vk, &pk.elf)
            .await
            .expect("registering program");
        Self { client, pk }
    }

    pub fn program_id(&self) -> Result<sdk::ProgramId> {
        Ok(sdk::ProgramId(serde_json::to_vec(&self.pk.vk)?))
    }

    pub async fn prove<T: BorshSerialize>(
        &self,
        commitment_metadata: Vec<u8>,
        calldatas: T,
    ) -> Result<ProofData> {
        // Setup the inputs.
        let mut stdin = SP1Stdin::new();
        let encoded = borsh::to_vec(&(commitment_metadata, calldatas))?;
        stdin.write_vec(encoded);

        // Generate the proof
        let proof = self
            .client
            .prove(&self.pk, &stdin)
            .compressed()
            .strategy(sp1_sdk::network::FulfillmentStrategy::Reserved)
            .run()
            .expect("failed to generate proof");

        let encoded_receipt = bincode::serialize(&proof)?;
        Ok(ProofData(encoded_receipt))
    }
}

impl<T: BorshSerialize + Send + 'static> ClientSdkProver<T> for SP1NetworkProver {
    fn prove(
        &self,
        commitment_metadata: Vec<u8>,
        calldatas: T,
    ) -> Pin<Box<dyn std::future::Future<Output = Result<ProofData>> + Send + '_>> {
        Box::pin(self.prove(commitment_metadata, calldatas))
    }
}
