use borsh::{io::Error, BorshDeserialize, BorshSerialize};
use hyle_hyllar::HyllarAction;
use serde::{Deserialize, Serialize};

use sdk::{ContractName, Identity, RunResult};

#[cfg(feature = "client")]
pub mod client;
#[cfg(feature = "client")]
pub mod indexer;

impl sdk::ZkContract for Faucet {
    /// Entry point of the contract's logic
    fn execute(&mut self, calldata: &sdk::Calldata) -> RunResult {
        // Parse contract inputs
        let (action, mut ctx) = sdk::utils::parse_calldata::<Nonced<FaucetAction>>(calldata)?;
        let identity = calldata.identity.clone();

        // Execute the given action
        let res = match action.action {
            FaucetAction::Click => {
                ctx.is_in_callee_blobs(
                    &ContractName("hyllar".to_string()),
                    HyllarAction::Transfer {
                        recipient: identity.0.rsplit_once('@').unwrap().0.to_string(),
                        amount: 1,
                    },
                )?;

                self.click(identity)?
            } // FaucetAction::BuyPowerup { name } => self.buy_powerup(identity, &name)?,
              // FaucetAction::Cashout => {
              //     let transfer = sdk::utils::parse_structured_blob::<HyllarAction>(
              //         &calldata.blobs,
              //         &sdk::BlobIndex(calldata.index.0 + 1),
              //     )
              //     .expect("Failed to parse transfer blob");
              //
              //     let HyllarAction::Transfer { recipient, amount } = transfer.data.parameters else {
              //         return Err("Hyllar blob is not a transfer".to_string());
              //     };
              //
              //     if format!("{}@{}", recipient, ctx.contract_name) != identity.to_string() {
              //         return Err("Recipient does not match the tx identity".to_string());
              //     }
              //
              //     self.cashout(identity, amount)?
              // }
        };

        Ok((res, ctx, vec![]))
    }

    /// In this example, we serialize the full state on-chain.
    fn commit(&self) -> sdk::StateCommitment {
        sdk::StateCommitment(self.as_bytes().expect("Failed to encsode Balances"))
    }
}

impl Faucet {
    pub fn new() -> Self {
        let powerups = vec![Powerup::Multiplier {
            name: "Wooden Click".to_string(),
            price: 100,
            multiplier_bonus: 1,
        }];

        Self {
            players: HashMap::new(),
            available_powerups: powerups,
        }
    }

    fn get_or_create_player(&mut self, identity: Identity) -> &mut PlayerState {
        self.players.entry(identity).or_insert_with(|| PlayerState {
            points: 0,
            multiplier: 1,
            owned_powerups: Vec::new(),
        })
    }

    pub fn click(&mut self, identity: Identity) -> Result<String, String> {
        let player = self.get_or_create_player(identity);
        player.points += player.multiplier;
        Ok(format!(
            "Clicked! Points: {}, Multiplier: {}",
            player.points, player.multiplier
        ))
    }

    pub fn buy_powerup(
        &mut self,
        identity: Identity,
        powerup_name: &str,
    ) -> Result<String, String> {
        let powerup = self
            .available_powerups
            .iter()
            .find(|p| match p {
                Powerup::Multiplier { name, .. } => name == powerup_name,
            })
            .cloned()
            .ok_or("Powerup not found")?;
        let player = self.get_or_create_player(identity);

        match powerup {
            Powerup::Multiplier {
                name,
                price,
                multiplier_bonus,
            } => {
                if player.points >= price {
                    player.points -= price;
                    player.multiplier += multiplier_bonus;
                    player.owned_powerups.push(name.clone());
                    Ok(format!(
                        "Powerup bought! Name: {}, New Multiplier: {}",
                        name, player.multiplier
                    ))
                } else {
                    Err(format!(
                        "Not enough points to buy powerup. Required: {}, Current: {}",
                        price, player.points
                    ))
                }
            }
        }
    }

    pub fn cashout(&mut self, identity: Identity, amount: u128) -> Result<String, String> {
        let player = self.get_or_create_player(identity);
        if player.points >= amount {
            player.points -= amount;
            Ok(format!("Cashout successful! Amount: {}", amount))
        } else {
            Err(format!(
                "Not enough points to cash out. Required: {}, Current: {}",
                amount, player.points
            ))
        }
    }
}

use std::collections::HashMap;

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Debug, Clone, Default)]
pub struct PlayerState {
    points: u128,
    multiplier: u128,

    owned_powerups: Vec<String>,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Debug, Clone)]
enum Powerup {
    Multiplier {
        name: String,
        price: u128,
        multiplier_bonus: u128,
    },
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Debug, Clone, Default)]
pub struct Faucet {
    players: HashMap<Identity, PlayerState>,
    available_powerups: Vec<Powerup>,
}

#[derive(Serialize, Deserialize, BorshSerialize, BorshDeserialize, Debug, Clone, PartialEq)]
pub struct Nonced<T> {
    pub action: T,
    pub nonce: u64,
}

/// Enum representing possible calls to the contract functions.
#[derive(Serialize, Deserialize, BorshSerialize, BorshDeserialize, Debug, Clone, PartialEq)]
pub enum FaucetAction {
    Click,
    // BuyPowerup { name: String },
    // Cashout,
}

impl FaucetAction {
    pub fn as_blob(&self, contract_name: sdk::ContractName) -> sdk::Blob {
        sdk::Blob {
            contract_name,
            data: sdk::BlobData(borsh::to_vec(self).expect("Failed to encode FaucetAction")),
        }
    }
}

impl Faucet {
    pub fn as_bytes(&self) -> Result<Vec<u8>, Error> {
        borsh::to_vec(self)
    }
}

impl From<sdk::StateCommitment> for Faucet {
    fn from(state: sdk::StateCommitment) -> Self {
        borsh::from_slice(&state.0)
            .map_err(|_| "Could not decode hyllar state".to_string())
            .unwrap()
    }
}
