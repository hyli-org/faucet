use std::str;

use anyhow::{anyhow, Context, Result};
use client_sdk::{
    contract_indexer::{
        axum::{extract::State, http::StatusCode, response::IntoResponse, Json, Router},
        utoipa::openapi::OpenApi,
        utoipa_axum::{router::OpenApiRouter, routes},
        AppError, ContractHandler, ContractHandlerStore,
    },
    transaction_builder::TxExecutorHandler,
};
use sdk::Hashed;
use serde::Serialize;

use crate::*;
use client_sdk::contract_indexer::axum;
use client_sdk::contract_indexer::utoipa;

impl ContractHandler for Faucet {
    async fn api(store: ContractHandlerStore<Faucet>) -> (Router<()>, OpenApi) {
        let (router, api) = OpenApiRouter::default()
            .routes(routes!(get_state))
            .split_for_parts();

        (router.with_state(store), api)
    }

    fn handle_transaction_success(
        &mut self,
        tx: &sdk::BlobTransaction,
        index: sdk::BlobIndex,
        tx_context: sdk::TxContext,
    ) -> Result<Option<()>> {
        let sdk::Blob {
            contract_name,
            data: _,
        } = tx.blobs.get(index.0).context("Failed to get blob")?;

        let calldata = sdk::Calldata {
            identity: tx.identity.clone(),
            index,
            blobs: tx.blobs.clone().into(),
            tx_blob_count: tx.blobs.len(),
            tx_hash: tx.hashed(),
            tx_ctx: Some(tx_context),
            private_input: vec![],
        };

        let hyle_output = self.handle(&calldata).map_err(|e| anyhow::anyhow!(e))?;
        let program_outputs = str::from_utf8(&hyle_output.program_outputs).unwrap_or("no output");

        sdk::info!("🚀 Executed {contract_name}: {}", program_outputs);
        sdk::tracing::debug!(
            handler = %contract_name,
            "hyle_output: {:?}", hyle_output
        );
        Ok(None)
    }
}

#[utoipa::path(
    get,
    path = "/state",
    tag = "Contract",
    responses(
        (status = OK, description = "Get json state of contract")
    )
)]
pub async fn get_state<S: Serialize + Clone + 'static>(
    State(state): State<ContractHandlerStore<S>>,
) -> Result<impl IntoResponse, AppError> {
    let store = state.read().await;
    store.state.clone().map(Json).ok_or(AppError(
        StatusCode::NOT_FOUND,
        anyhow!("No state found for contract '{}'", store.contract_name),
    ))
}
