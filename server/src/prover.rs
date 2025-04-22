use std::{fmt::Debug, sync::Arc};

use crate::app::{AppEvent, AppModuleCtx};
use anyhow::{anyhow, Result};
use borsh::BorshDeserialize;
use client_sdk::{contract_indexer::ContractStateStore, transaction_builder::TxExecutorHandler};
use hyle::{
    bus::BusClientSender,
    log_error, module_handle_messages,
    node_state::module::NodeStateEvent,
    utils::modules::{module_bus_client, Module},
};
use sdk::{
    BlobIndex, BlobTransaction, Block, BlockHeight, Calldata, ContractName, Hashed,
    ProofTransaction, TransactionData, TxHash, HYLE_TESTNET_CHAIN_ID,
};
use tracing::{debug, error, info};

pub struct ProverModule<Contract> {
    bus: ProverModuleBusClient,
    ctx: Arc<ProverModuleCtx>,
    unsettled_txs: Vec<(BlobTransaction, sdk::TxContext)>,
    state_history: Vec<(TxHash, Contract)>,
    contract: Contract,
}

module_bus_client! {
#[derive(Debug)]
pub struct ProverModuleBusClient {
    sender(AppEvent),
    receiver(NodeStateEvent),
}
}
pub struct ProverModuleCtx {
    pub app: Arc<AppModuleCtx>,
    pub start_height: BlockHeight,
    pub elf: &'static [u8],
    pub contract_name: ContractName,
}

impl<Contract> Module for ProverModule<Contract>
where
    Contract: TxExecutorHandler + BorshDeserialize + Default + Debug + Send + Clone + 'static,
{
    type Context = Arc<ProverModuleCtx>;

    async fn build(ctx: Self::Context) -> Result<Self> {
        let bus = ProverModuleBusClient::new_from_bus(ctx.app.common.bus.new_handle()).await;

        let file = ctx
            .app
            .common
            .config
            .data_directory
            .join(format!("state_indexer_{}.bin", ctx.contract_name).as_str());

        let store = Self::load_from_disk_or_default::<ContractStateStore<Contract>>(file.as_path());

        let contract = store.state.unwrap_or_default();

        Ok(ProverModule {
            bus,
            contract,
            ctx,
            unsettled_txs: vec![],
            state_history: vec![],
        })
    }

    async fn run(&mut self) -> Result<()> {
        module_handle_messages! {
            on_bus self.bus,
            listen<NodeStateEvent> event => {
                _ = log_error!(self.handle_node_state_event(event).await, "handle note state event")
            }

        };

        Ok(())
    }
}

impl<Contract> ProverModule<Contract>
where
    Contract: TxExecutorHandler + Default + Debug + Clone,
{
    async fn handle_node_state_event(&mut self, event: NodeStateEvent) -> Result<()> {
        let NodeStateEvent::NewBlock(block) = event;
        self.handle_processed_block(*block).await?;

        Ok(())
    }

    async fn handle_processed_block(&mut self, block: Block) -> Result<()> {
        info!("🔧 Processing block: {:?}", block.block_height);
        let mut blobs = vec![];
        for (_, tx) in block.txs {
            if let TransactionData::Blob(tx) = tx.transaction_data {
                let tx_ctx = sdk::TxContext {
                    block_height: block.block_height,
                    block_hash: block.hash.clone(),
                    timestamp: block.block_timestamp.clone(),
                    lane_id: block.lane_ids.get(&tx.hashed()).unwrap().clone(),
                    chain_id: HYLE_TESTNET_CHAIN_ID,
                };
                blobs.extend(self.handle_blob(tx, tx_ctx));
            }
        }
        self.prove_supported_blob(blobs);

        for tx in block.successful_txs {
            self.settle_tx_success(tx)?;
        }

        for tx in block.timed_out_txs {
            self.settle_tx_failed(tx)?;
        }

        for tx in block.failed_txs {
            self.settle_tx_failed(tx)?;
        }

        info!("🔧 Finished processing block: {:?}", block.block_height);

        Ok(())
    }

    fn handle_blob(
        &mut self,
        tx: BlobTransaction,
        tx_ctx: sdk::TxContext,
    ) -> Vec<(BlobIndex, BlobTransaction, sdk::TxContext)> {
        let mut blobs = vec![];
        for (index, blob) in tx.blobs.iter().enumerate() {
            if blob.contract_name == self.ctx.contract_name {
                blobs.push((index.into(), tx.clone(), tx_ctx.clone()));
            }
        }
        self.unsettled_txs.push((tx, tx_ctx));
        blobs
    }

    fn settle_tx_success(&mut self, tx: TxHash) -> Result<()> {
        let pos = self.state_history.iter().position(|(h, _)| h == &tx);
        if let Some(pos) = pos {
            self.state_history = self.state_history.split_off(pos);
        }
        self.settle_tx(tx)?;
        Ok(())
    }

    fn settle_tx_failed(&mut self, tx: TxHash) -> Result<()> {
        self.handle_all_next_blobs(tx.clone())?;
        self.state_history.retain(|(h, _)| h != &tx);
        self.settle_tx(tx)
    }

    fn settle_tx(&mut self, tx: TxHash) -> Result<()> {
        let tx = self
            .unsettled_txs
            .iter()
            .position(|(t, _)| t.hashed() == tx);
        if let Some(pos) = tx {
            self.unsettled_txs.remove(pos);
        }
        Ok(())
    }

    fn handle_all_next_blobs(&mut self, failed_tx: TxHash) -> Result<()> {
        let idx = self
            .unsettled_txs
            .iter()
            .position(|(t, _)| t.hashed() == failed_tx);
        let prev_state = self
            .state_history
            .iter()
            .enumerate()
            .find(|(_, (h, _))| h == &failed_tx)
            .and_then(|(i, _)| {
                if i > 0 {
                    self.state_history.get(i - 1)
                } else {
                    None
                }
            });
        if let Some((_, contract)) = prev_state {
            debug!("Reverting to previous state: {:?}", contract);
            self.contract = contract.clone();
        } else {
            self.contract = Contract::default();
        }
        let mut blobs = vec![];
        for (tx, ctx) in self.unsettled_txs.clone().iter().skip(idx.unwrap_or(0) + 1) {
            for (index, blob) in tx.blobs.iter().enumerate() {
                if blob.contract_name == self.ctx.contract_name {
                    debug!(
                        "Re-execute blob for tx {} after a previous tx failure",
                        tx.hashed()
                    );
                    self.state_history.retain(|(h, _)| h != &tx.hashed());
                    blobs.push((index.into(), tx.clone(), ctx.clone()));
                }
            }
        }
        self.prove_supported_blob(blobs);

        Ok(())
    }

    fn prove_supported_blob(&mut self, blobs: Vec<(BlobIndex, BlobTransaction, sdk::TxContext)>) {
        let mut calldatas = vec![];
        let mut initial_commitment_metadata = None;
        let len = blobs.len();
        for (blob_index, tx, tx_ctx) in blobs {
            let old_tx = tx_ctx.block_height.0 < self.ctx.start_height.0;

            let blob = tx.blobs.get(blob_index.0).unwrap();
            let blobs = tx.blobs.clone();
            let tx_hash = tx.hashed();

            let state = self.contract.build_commitment_metadata(blob).unwrap();

            let commitment_metadata = state;

            if initial_commitment_metadata.is_none() {
                initial_commitment_metadata = Some(commitment_metadata.clone());
            }

            let calldata = Calldata {
                identity: tx.identity.clone(),
                tx_hash: tx_hash.clone(),
                private_input: vec![],
                blobs: blobs.clone().into(),
                index: blob_index,
                tx_ctx: Some(tx_ctx.clone()),
                tx_blob_count: blobs.len(),
            };

            match self.contract.handle(&calldata).map_err(|e| anyhow!(e)) {
                Err(e) => {
                    info!("{} Error while executing contract: {e}", tx.hashed());
                    if !old_tx {
                        self.bus
                            .send(AppEvent::FailedTx(tx_hash.clone(), e.to_string()))
                            .unwrap();
                    }
                }
                Ok(msg) => {
                    info!(
                        "{} Executed contract: {}",
                        tx.hashed(),
                        String::from_utf8_lossy(&msg.program_outputs)
                    );
                }
            }

            self.state_history
                .push((tx_hash.clone(), self.contract.clone()));

            if old_tx {
                return;
            }

            self.bus
                .send(AppEvent::SequencedTx(tx_hash.clone()))
                .unwrap();

            calldatas.push(calldata);
        }

        let Some(commitment_metadata) = initial_commitment_metadata else {
            return;
        };

        let node_client = self.ctx.app.node_client.clone();
        let prover = custom::Risc0Prover::new(self.ctx.elf);
        let contract_name = self.ctx.contract_name.clone();
        tokio::task::spawn(async move {
            match prover.prove(commitment_metadata, calldatas).await {
                Ok(proof) => {
                    let tx = ProofTransaction {
                        contract_name: contract_name.clone(),
                        proof,
                    };
                    let _ = log_error!(
                        node_client.send_tx_proof(&tx).await,
                        "failed to send proof to node"
                    );
                    info!("✅ Proved {len} txs");
                }
                Err(e) => {
                    error!("Error proving tx: {:?}", e);
                }
            };
        });
    }
}

pub mod custom {

    use std::pin::Pin;

    use client_sdk::helpers::ClientSdkProver;
    use sdk::*;

    use super::*;

    pub struct Risc0Prover<'a> {
        binary: &'a [u8],
    }
    impl<'a> Risc0Prover<'a> {
        pub fn new(binary: &'a [u8]) -> Self {
            Self { binary }
        }
        pub async fn prove(
            &self,
            commitment_metadata: Vec<u8>,
            calldata: Vec<Calldata>,
        ) -> Result<ProofData> {
            let explicit = std::env::var("RISC0_PROVER").unwrap_or_default();
            let receipt = match explicit.to_lowercase().as_str() {
                // "bonsai" => {
                //     let input_data =
                //         bonsai_runner::as_input_data(&(commitment_metadata, calldata))?;
                //     bonsai_runner::run_bonsai(self.binary, input_data.clone()).await?
                // }
                _ => {
                    let input_data = borsh::to_vec(&(commitment_metadata, calldata))?;
                    let env = risc0_zkvm::ExecutorEnv::builder()
                        .write(&input_data.len())?
                        .write_slice(&input_data)
                        .build()
                        .unwrap();

                    let prover = risc0_zkvm::default_prover();
                    let prove_info = prover.prove(env, self.binary)?;
                    prove_info.receipt
                }
            };

            let encoded_receipt = borsh::to_vec(&receipt).expect("Unable to encode receipt");
            Ok(ProofData(encoded_receipt))
        }
    }

    // impl ClientSdkProver for Risc0Prover<'_> {
    //     fn prove(
    //         &self,
    //         commitment_metadata: Vec<u8>,
    //         calldata: Calldata,
    //     ) -> Pin<Box<dyn std::future::Future<Output = Result<ProofData>> + Send + '_>> {
    //         Box::pin(self.prove(commitment_metadata, calldata))
    //     }
    // }
}
