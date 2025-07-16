use std::str;

use anyhow::{anyhow, Result};
use borsh::{BorshDeserialize, BorshSerialize};
use client_sdk::{
    contract_indexer::{
        axum::{
            extract::{Path, State},
            http::StatusCode,
            response::IntoResponse,
            Json, Router,
        },
        utoipa::openapi::OpenApi,
        utoipa_axum::{router::OpenApiRouter, routes},
        AppError, ContractHandler, ContractHandlerStore,
    },
    transaction_builder::TxExecutorHandler,
};
use sdk::{Identity, RegisterContractEffect, StateCommitment};
use serde::Serialize;

use crate::*;
use client_sdk::contract_indexer::axum;
use client_sdk::contract_indexer::utoipa;

#[derive(Debug, Clone, Serialize, serde::Deserialize, BorshSerialize, BorshDeserialize)]
pub struct FaucetCustomState {
    pub contract: Faucet,
    pub balances: HashMap<Identity, u128>,
}

impl TxExecutorHandler for FaucetCustomState {
    fn handle(&mut self, calldata: &sdk::Calldata) -> anyhow::Result<sdk::HyleOutput> {
        self.contract.handle(calldata)
    }

    fn build_commitment_metadata(&self, blob: &sdk::Blob) -> anyhow::Result<Vec<u8>> {
        self.contract.build_commitment_metadata(blob)
    }

    fn get_state_commitment(&self) -> StateCommitment {
        StateCommitment::default()
    }

    fn construct_state(
        _register_blob: &RegisterContractEffect,
        _metadata: &Option<Vec<u8>>,
    ) -> anyhow::Result<Self> {
        // Inclure le fichier JSON au moment de la compilation
        const INITIAL_STATE: &str = include_str!("./testnet_dump.json");

        // Parser le contenu JSON
        let state: FaucetCustomState = serde_json::from_str(INITIAL_STATE)
            .map_err(|e| anyhow!("Failed to parse testnet_dump.json: {}", e))?;

        Ok(state)
    }
}

impl ContractHandler for FaucetCustomState {
    async fn api(store: ContractHandlerStore<FaucetCustomState>) -> (Router<()>, OpenApi) {
        let (router, api) = OpenApiRouter::default()
            .routes(routes!(get_state))
            .routes(routes!(get_leaderboard))
            .routes(routes!(get_balance))
            .split_for_parts();

        (router.with_state(store), api)
    }

    fn handle_transaction_success(
        &mut self,
        tx: &sdk::BlobTransaction,
        _index: sdk::BlobIndex,
        _tx_context: sdk::TxContext,
    ) -> Result<Option<()>> {
        self.balances
            .entry(tx.identity.clone().0.replace("@faucet", "").into())
            .and_modify(|balance| {
                *balance += 1; // Increment balance for each transaction
            })
            .or_insert(1); // Initialize balance if not present

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

#[utoipa::path(
    get,
    path = "/leaderboard/{account}",
    params(
        ("account" = String, Path, description = "Optional account to get rank for")
    ),
    tag = "Contract",
    responses(
        (status = OK, description = "Get json leaderboard and optional rank")
    )
)]
pub async fn get_leaderboard(
    Path(account): Path<Identity>,
    State(state): State<ContractHandlerStore<FaucetCustomState>>,
) -> Result<impl IntoResponse, AppError> {
    let store = state.read().await;
    let mut leaderboard: Vec<_> = store
        .state
        .clone()
        .map(|s| s.balances.into_iter().collect())
        .unwrap_or_default();
    leaderboard.sort_by(|a, b| b.1.cmp(&a.1)); // Sort by balance descending

    // If account is provided, calculate rank
    let rank = if !store
        .state
        .as_ref()
        .map(|s| s.balances.contains_key(&account))
        .unwrap_or(false)
    {
        Some(leaderboard.len() + 1) // Account not found, return rank as last position
    } else {
        leaderboard
            .iter()
            .position(|(identity, _)| identity == &account)
            .map(|pos| pos + 1)
    };
    let leaderboard: HashMap<Identity, u128> = leaderboard.into_iter().take(200).collect();

    // Create response with leaderboard and optional rank
    #[derive(serde::Serialize)]
    struct LeaderboardResponse {
        leaderboard: HashMap<Identity, u128>,
        rank: Option<usize>,
    }

    let response = LeaderboardResponse { leaderboard, rank };

    Ok(Json(response))
}

#[utoipa::path(
    get,
    path = "/balance/{account}",
    params(
        ("account" = String, Path, description = "Account")
    ),
    tag = "Contract",
    responses(
        (status = OK, description = "Get json balance of account")
    )
)]
pub async fn get_balance(
    Path(account): Path<Identity>,
    State(state): State<ContractHandlerStore<FaucetCustomState>>,
) -> Result<impl IntoResponse, AppError> {
    let store = state.read().await;
    store
        .state
        .clone()
        .map(|s| s.balances.get(&account).cloned().unwrap_or(0))
        .map(Json)
        .ok_or(AppError(
            StatusCode::NOT_FOUND,
            anyhow!("No balance found for account '{}'", account),
        ))
}
