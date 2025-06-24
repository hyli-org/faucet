use std::sync::Arc;

use anyhow::Result;
use axum::{
    extract::{Json, State},
    http::Method,
    response::IntoResponse,
    routing::get,
    Router,
};
use client_sdk::rest_client::NodeApiHttpClient;
use hyle_modules::{
    bus::SharedMessageBus,
    module_handle_messages,
    modules::{module_bus_client, BuildApiContextInner, Module},
};

use sdk::ContractName;
use serde::Serialize;
use tower_http::cors::{Any, CorsLayer};

pub struct AppModule {
    bus: AppModuleBusClient,
}

pub struct AppModuleCtx {
    pub api: Arc<BuildApiContextInner>,
    pub node_client: Arc<NodeApiHttpClient>,
    pub faucet_cn: ContractName,
}

module_bus_client! {
#[derive(Debug)]
pub struct AppModuleBusClient {
}
}

impl Module for AppModule {
    type Context = Arc<AppModuleCtx>;

    async fn build(bus: SharedMessageBus, ctx: Self::Context) -> Result<Self> {
        let state = RouterCtx {
            faucet_cn: ctx.faucet_cn.clone(),
        };

        // Créer un middleware CORS
        let cors = CorsLayer::new()
            .allow_origin(Any) // Permet toutes les origines (peut être restreint)
            .allow_methods(vec![Method::GET, Method::POST]) // Permet les méthodes nécessaires
            .allow_headers(Any); // Permet tous les en-têtes

        let api = Router::new()
            .route("/_health", get(health))
            .route("/api/config", get(get_config))
            .with_state(state)
            .layer(cors); // Appliquer le middleware CORS

        if let Ok(mut guard) = ctx.api.router.lock() {
            if let Some(router) = guard.take() {
                guard.replace(router.merge(api));
            }
        }
        let bus = AppModuleBusClient::new_from_bus(bus.new_handle()).await;

        Ok(AppModule { bus })
    }

    async fn run(&mut self) -> Result<()> {
        module_handle_messages! {
            on_self self,
        };

        Ok(())
    }
}

#[derive(Clone)]
struct RouterCtx {
    pub faucet_cn: ContractName,
}

async fn health() -> impl IntoResponse {
    Json("OK")
}

// --------------------------------------------------------
//     Routes
// --------------------------------------------------------

#[derive(Serialize)]
struct ConfigResponse {
    contract_name: String,
}

async fn get_config(State(ctx): State<RouterCtx>) -> impl IntoResponse {
    Json(ConfigResponse {
        contract_name: ctx.faucet_cn.0,
    })
}
